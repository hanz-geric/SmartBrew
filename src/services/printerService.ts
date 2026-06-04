// Printer transport service.
// Native modules (TCP socket, Bluetooth) are loaded dynamically so the app
// bundles cleanly in managed Expo. They activate only after `expo prebuild`.

import { PermissionsAndroid, Platform } from 'react-native';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export class BluetoothPreconditionError extends Error {
  constructor(message: string, public readonly settingsIntent: 'app-settings' | 'android.settings.BLUETOOTH_SETTINGS') {
    super(message);
    this.name = 'BluetoothPreconditionError';
  }
}

export interface PrinterConfig {
  type:      'wifi' | 'bluetooth';
  ip?:       string;
  port?:     number;
  btDevice?: string;
}

export interface DiscoveredPrinter {
  name:    string;
  address: string;  // IP for WiFi, MAC/device-name for Bluetooth
  type:    'wifi' | 'bluetooth';
  paired?: boolean; // Bluetooth only
}

// ─── WiFi (TCP) ───────────────────────────────────────────────────────────────

async function sendWifi(bytes: Uint8Array, ip: string, port: number): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('WiFi printing is not supported on web.');
  }
  let TcpSocket: typeof import('react-native-tcp-socket');
  try {
    TcpSocket = require('react-native-tcp-socket');
  } catch {
    throw new Error(
      'WiFi printing requires the native build.\n' +
      'Run: npx expo prebuild, then rebuild the app.',
    );
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error('Printer connection timed out (5 s). Check IP and network.'));
    }, 5_000);

    const client = TcpSocket.createConnection({ host: ip, port }, () => {
      client.write(toBase64(bytes), 'base64');
      client.end();
    });

    client.on('close', () => { clearTimeout(timer); resolve(); });
    client.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
  });
}

// ─── Bluetooth permissions (Android 12+) ─────────────────────────────────────

async function ensureBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const api = Platform.Version as number;
  if (api >= 31) {
    // BLUETOOTH_SCAN is declared with neverForLocation so location permission is not needed.
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    const denied =
      result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]    !== PermissionsAndroid.RESULTS.GRANTED ||
      result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] !== PermissionsAndroid.RESULTS.GRANTED;
    if (denied) throw new BluetoothPreconditionError(
      'Bluetooth permission denied. Grant it in Settings → Apps → SmartBrew POS → Permissions.',
      'app-settings',
    );
  } else {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new BluetoothPreconditionError(
        'Location permission is required for Bluetooth scanning on Android 11 and below.',
        'app-settings',
      );
    }
  }
}

// ─── Bluetooth (Classic SPP) ──────────────────────────────────────────────────

interface BtDevice { name: string; address: string; bonded?: boolean }

interface RNBluetoothClassic {
  isBluetoothEnabled:      () => Promise<boolean>;
  requestBluetoothEnabled: () => Promise<boolean>;
  getBondedDevices:        () => Promise<BtDevice[]>;
  getConnectedDevices:     () => Promise<BtDevice[]>;
  startDiscovery:          () => Promise<BtDevice[]>;
  cancelDiscovery:         () => Promise<boolean>;
  connectToDevice:         (address: string, options?: Record<string, unknown>) => Promise<BtDevice>;
  disconnectFromDevice:    (address: string) => Promise<boolean>;
  isDeviceConnected:       (address: string) => Promise<boolean>;
  writeToDevice:           (address: string, message: string, encoding?: string) => Promise<boolean>;
}

function loadBluetoothClassic(): RNBluetoothClassic {
  try {
    const mod = require('react-native-bluetooth-classic');
    return (mod.default ?? mod) as RNBluetoothClassic;
  } catch {
    throw new Error(
      'Bluetooth printing requires the native build.\n' +
      'Run: npx expo prebuild, then rebuild the app.',
    );
  }
}

// Reject `p` if it does not settle within `ms`; the underlying native op keeps
// running, so callers clean up (e.g. cancelDiscovery) in a finally block.
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function ensureBluetoothReady(BT: RNBluetoothClassic): Promise<void> {
  await ensureBluetoothPermissions();
  if (await BT.isBluetoothEnabled()) return;
  if (Platform.OS !== 'android') {
    throw new Error('Bluetooth is off. Please enable it in Settings and try again.');
  }
  const enabled = await BT.requestBluetoothEnabled();
  if (!enabled) {
    throw new BluetoothPreconditionError(
      'Bluetooth is off. Turn it on to print.',
      'android.settings.BLUETOOTH_SETTINGS',
    );
  }
}

// Connect to a paired printer, preferring an INSECURE RFCOMM socket.
// Most ESC/POS thermal printers reject the default secure socket with
// "read failed, socket might closed or timeout, read ret: -1" because they
// don't support authenticated/encrypted RFCOMM. We try insecure first (the
// printer-friendly path) and fall back to secure for the rare device that
// requires it, surfacing the original insecure error if both fail.
async function connectBluetooth(BT: RNBluetoothClassic, address: string): Promise<void> {
  // Android can't reliably open an RFCOMM socket while the adapter is still
  // scanning. A discovery left running by a recent printer search makes
  // connect() hang (insecure) or fail with read ret: -1 (secure). The native
  // library never cancels it for us, so always stop discovery first.
  await BT.cancelDiscovery().catch(() => undefined);

  // Free the radio for this printer. A held-open SPP link to a *different*
  // printer (e.g. the receipt printer, which we never explicitly disconnect)
  // makes a concurrent connect to a second printer fail or hang on many
  // phones — the first printer to connect wins, the second is refused. Drop
  // any other open connection before connecting this one.
  const others = await BT.getConnectedDevices().catch(() => [] as BtDevice[]);
  const toDrop = others.filter((d) => d.address !== address);
  await Promise.all(toDrop.map((d) => BT.disconnectFromDevice(d.address).catch(() => undefined)));

  // Let the radio tear down the old RFCOMM link before opening a new one;
  // an immediate reconnect to a different device often fails otherwise. Only
  // pay this cost when we actually switched away from another printer.
  if (toDrop.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  const attempt = (secureSocket: boolean) => withTimeout(
    BT.connectToDevice(address, { secureSocket }),
    10_000,
    'Could not connect to the Bluetooth printer (10 s). Make sure it is on and in range.',
  );
  try {
    await attempt(false);
  } catch (insecureErr) {
    try {
      await attempt(true);
    } catch {
      throw insecureErr;
    }
  }
}

async function sendBluetooth(bytes: Uint8Array, deviceName: string): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Bluetooth printing is not supported on web.');
  }
  const BT = loadBluetoothClassic();
  await ensureBluetoothReady(BT);

  // Fast path: connect to an already-paired printer by name or address.
  // (Avoids the ~12 s discovery that the old library forced on every print.)
  const bonded = await BT.getBondedDevices();
  const target = bonded.find((d) => d.name === deviceName || d.address === deviceName);
  if (!target) {
    throw new Error(
      `Bluetooth device "${deviceName}" is not paired. ` +
      'Pair it in your device Bluetooth settings first.',
    );
  }

  const connected = await BT.isDeviceConnected(target.address).catch(() => false);
  if (!connected) {
    await connectBluetooth(BT, target.address);
  }

  // Base64-encoded so the library decodes to raw ESC/POS bytes on the native side.
  await BT.writeToDevice(target.address, toBase64(bytes), 'base64');
}

// ─── Discovery ────────────────────────────────────────────────────────────────

export async function scanWifiPrinters(): Promise<DiscoveredPrinter[]> {
  if (Platform.OS === 'web') return [];
  let Zeroconf: new () => {
    on: (event: string, cb: (service: { name: string; host: string; addresses?: string[]; port: number }) => void) => void;
    scan: (type: string, protocol: string, domain: string) => void;
    stop: () => void;
  };
  try {
    const mod = require('react-native-zeroconf');
    Zeroconf = mod.default ?? mod;
  } catch {
    throw new Error(
      'WiFi printer scanning requires the native build.\n' +
      'Run: npx expo prebuild, then rebuild the app.',
    );
  }
  const zc = new Zeroconf();
  return await new Promise<DiscoveredPrinter[]>((resolve) => {
    const found: DiscoveredPrinter[] = [];
    zc.on('resolved', (service) => {
      const address = service.addresses?.[0] ?? service.host;
      found.push({ name: service.name, address, type: 'wifi' });
    });
    ['pdl-datastream', 'printer', 'ipp'].forEach((svc) =>
      zc.scan(svc, 'tcp', 'local.'),
    );
    setTimeout(() => { zc.stop(); resolve(found); }, 5_000);
  });
}

export async function scanBluetoothPrinters(): Promise<DiscoveredPrinter[]> {
  if (Platform.OS === 'web') return [];
  const BT = loadBluetoothClassic();
  await ensureBluetoothReady(BT);

  // Paired devices first — instant, and the common case for a configured printer.
  const bonded = await BT.getBondedDevices();
  const seen   = new Set(bonded.map((d) => d.address));
  const results: DiscoveredPrinter[] = bonded.map((d) => ({
    name: d.name || d.address, address: d.address, type: 'bluetooth', paired: true,
  }));

  // Then a best-effort, time-boxed discovery for nearby unpaired devices.
  // Failure here is non-fatal: paired devices are still returned.
  try {
    const discovered = await withTimeout(BT.startDiscovery(), 15_000, 'DISCOVERY_TIMEOUT');
    for (const d of discovered) {
      if (seen.has(d.address)) continue;
      seen.add(d.address);
      results.push({ name: d.name || d.address, address: d.address, type: 'bluetooth', paired: false });
    }
  } catch {
    // ignore — discovery is optional
  } finally {
    await BT.cancelDiscovery().catch(() => undefined);
  }

  return results;
}

// Best-effort: drop any live SPP link to this printer so the user can pair and
// reconfigure from a clean slate. Never throws — if the native module is
// missing, Bluetooth is off, or nothing is connected, there's nothing to do.
export async function disconnectBluetoothPrinter(deviceName: string): Promise<void> {
  if (Platform.OS === 'web' || !deviceName) return;
  try {
    const BT = loadBluetoothClassic();
    const connected = await BT.getConnectedDevices().catch(() => [] as BtDevice[]);
    const match = connected.find((d) => d.name === deviceName || d.address === deviceName);
    if (match) await BT.disconnectFromDevice(match.address).catch(() => undefined);
  } catch {
    // Native module unavailable (managed Expo / web) — nothing to disconnect.
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function printBytes(bytes: Uint8Array, config: PrinterConfig): Promise<void> {
  if (bytes.length === 0) return;
  if (config.type === 'wifi') {
    if (!config.ip) throw new Error('Printer IP address is not configured.');
    await sendWifi(bytes, config.ip, config.port ?? 9100);
  } else {
    if (!config.btDevice) throw new Error('Bluetooth device name is not configured.');
    await sendBluetooth(bytes, config.btDevice);
  }
}
