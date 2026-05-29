// Printer transport service.
// Native modules (TCP socket, Bluetooth) are loaded dynamically so the app
// bundles cleanly in managed Expo. They activate only after `expo prebuild`.

import { Platform } from 'react-native';

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
      client.write(Buffer.from(bytes));
      client.end();
    });

    client.on('close', () => { clearTimeout(timer); resolve(); });
    client.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
  });
}

// ─── Bluetooth (SPP) ──────────────────────────────────────────────────────────

async function sendBluetooth(bytes: Uint8Array, deviceName: string): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Bluetooth printing is not supported on web.');
  }
  let BM: { connect: (addr: string) => Promise<void>; scanDevices: () => Promise<{ paired: string; found: string }> };
  let BEP: { printRaw: (data: string) => Promise<void> };
  try {
    const lib = require('react-native-bluetooth-escpos-printer');
    BM  = lib.BluetoothManager;
    BEP = lib.BluetoothEscposPrinter;
  } catch {
    throw new Error(
      'Bluetooth printing requires the native build.\n' +
      'Run: npx expo prebuild, then rebuild the app.',
    );
  }

  const result  = await BM.scanDevices();
  const paired  = JSON.parse(result.paired ?? '[]') as Array<{ name: string; address: string }>;
  const nearby  = JSON.parse(result.found  ?? '[]') as Array<{ name: string; address: string }>;
  const target  = [...paired, ...nearby].find(
    (d) => d.name === deviceName || d.address === deviceName,
  );
  if (!target) throw new Error(`Bluetooth device "${deviceName}" not found or not paired.`);

  await BM.connect(target.address);
  // Send raw bytes as hex string (library-specific encoding)
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  await BEP.printRaw(hex);
}

// ─── Discovery ────────────────────────────────────────────────────────────────

export async function scanWifiPrinters(): Promise<DiscoveredPrinter[]> {
  if (Platform.OS === 'web') return [];
  try {
    // react-native-zeroconf is only available after expo prebuild
    const Zeroconf = require('react-native-zeroconf').default ?? require('react-native-zeroconf');
    const zc = new Zeroconf();
    return await new Promise<DiscoveredPrinter[]>((resolve) => {
      const found: DiscoveredPrinter[] = [];
      zc.on('resolved', (service: { name: string; host: string; port: number }) => {
        found.push({ name: service.name, address: service.host, type: 'wifi' });
      });
      // Scan for standard printer mDNS service types
      ['pdl-datastream', 'printer', 'ipp'].forEach((svc) =>
        zc.scan(svc, 'tcp', 'local.'),
      );
      setTimeout(() => { zc.stop(); resolve(found); }, 5_000);
    });
  } catch {
    return []; // native module not installed yet
  }
}

export async function scanBluetoothPrinters(): Promise<DiscoveredPrinter[]> {
  if (Platform.OS === 'web') return [];
  try {
    const { BluetoothManager } = require('react-native-bluetooth-escpos-printer');
    const result = await BluetoothManager.scanDevices() as { paired: string; found: string };
    const paired = JSON.parse(result.paired ?? '[]') as Array<{ name: string; address: string }>;
    const found  = JSON.parse(result.found  ?? '[]') as Array<{ name: string; address: string }>;
    return [
      ...paired.map((d) => ({ name: d.name ?? d.address, address: d.address, type: 'bluetooth' as const, paired: true  })),
      ...found .map((d) => ({ name: d.name ?? d.address, address: d.address, type: 'bluetooth' as const, paired: false })),
    ];
  } catch {
    return [];
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
