import { Platform, PermissionsAndroid } from 'react-native';
import {
  BluetoothPreconditionError,
  scanBluetoothPrinters,
  printBytes,
} from '../printerService';

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  Platform: {
    OS:      'android',
    Version: 31,
    select:  (spec: Record<string, unknown>) => spec.android ?? spec.default,
  },
  PermissionsAndroid: {
    PERMISSIONS: {
      BLUETOOTH_SCAN:       'android.permission.BLUETOOTH_SCAN',
      BLUETOOTH_CONNECT:    'android.permission.BLUETOOTH_CONNECT',
      ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
    },
    RESULTS: {
      GRANTED:         'granted',
      DENIED:          'denied',
      NEVER_ASK_AGAIN: 'never_ask_again',
    },
    requestMultiple: jest.fn(),
    request:         jest.fn(),
  },
}));

// `virtual` so the suite runs before the native package is installed; jest uses
// this factory whether or not react-native-bluetooth-classic is on disk.
jest.mock('react-native-bluetooth-classic', () => ({
  __esModule: true,
  default: {
    isBluetoothEnabled:      jest.fn(),
    requestBluetoothEnabled: jest.fn(),
    getBondedDevices:        jest.fn(),
    getConnectedDevices:     jest.fn(),
    startDiscovery:          jest.fn(),
    cancelDiscovery:         jest.fn(),
    connectToDevice:         jest.fn(),
    disconnectFromDevice:    jest.fn(),
    isDeviceConnected:       jest.fn(),
    writeToDevice:           jest.fn(),
  },
}), { virtual: true });

jest.mock('react-native-tcp-socket',  () => ({}));
jest.mock('react-native-zeroconf',    () => ({}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BT = jest.requireMock('react-native-bluetooth-classic').default;

function setPlatform(os: string, version: number) {
  Object.defineProperty(Platform, 'OS',      { get: () => os,      configurable: true });
  Object.defineProperty(Platform, 'Version', { get: () => version, configurable: true });
}

function grantPermissions() {
  (PermissionsAndroid.requestMultiple as jest.Mock).mockResolvedValue({
    [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]:    PermissionsAndroid.RESULTS.GRANTED,
    [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]: PermissionsAndroid.RESULTS.GRANTED,
  });
}

// ─── BluetoothPreconditionError ───────────────────────────────────────────────

describe('BluetoothPreconditionError', () => {
  it('is an instance of both Error and BluetoothPreconditionError', () => {
    const e = new BluetoothPreconditionError('msg', 'app-settings');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(BluetoothPreconditionError);
  });

  it('sets name, message, and settingsIntent', () => {
    const e = new BluetoothPreconditionError('Toggle Bluetooth', 'android.settings.BLUETOOTH_SETTINGS');
    expect(e.name).toBe('BluetoothPreconditionError');
    expect(e.message).toBe('Toggle Bluetooth');
    expect(e.settingsIntent).toBe('android.settings.BLUETOOTH_SETTINGS');
  });

  it('accepts app-settings intent', () => {
    const e = new BluetoothPreconditionError('Grant permission', 'app-settings');
    expect(e.settingsIntent).toBe('app-settings');
  });
});

// ─── scanBluetoothPrinters ────────────────────────────────────────────────────

describe('scanBluetoothPrinters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform('android', 31);
    grantPermissions();
    BT.isBluetoothEnabled.mockResolvedValue(true);
    BT.getBondedDevices.mockResolvedValue([]);
    BT.startDiscovery.mockResolvedValue([]);
    BT.cancelDiscovery.mockResolvedValue(true);
  });

  it('returns [] immediately on web without touching native modules', async () => {
    setPlatform('web', 0);
    await expect(scanBluetoothPrinters()).resolves.toEqual([]);
    expect(BT.getBondedDevices).not.toHaveBeenCalled();
    expect(BT.startDiscovery).not.toHaveBeenCalled();
  });

  // ── Bluetooth off ────────────────────────────────────────────────────────────

  describe('Bluetooth disabled', () => {
    it('throws BluetoothPreconditionError when the user declines to enable it', async () => {
      BT.isBluetoothEnabled.mockResolvedValue(false);
      BT.requestBluetoothEnabled.mockResolvedValue(false);
      const err = await scanBluetoothPrinters().catch(e => e);
      expect(err).toBeInstanceOf(BluetoothPreconditionError);
      expect(err.settingsIntent).toBe('android.settings.BLUETOOTH_SETTINGS');
    });

    it('proceeds when the user accepts the enable prompt', async () => {
      BT.isBluetoothEnabled.mockResolvedValue(false);
      BT.requestBluetoothEnabled.mockResolvedValue(true);
      await expect(scanBluetoothPrinters()).resolves.toEqual([]);
      expect(BT.getBondedDevices).toHaveBeenCalled();
    });
  });

  // ── Discovery failures are non-fatal ──────────────────────────────────────────

  describe('discovery resilience', () => {
    it('still returns paired devices when discovery rejects', async () => {
      BT.getBondedDevices.mockResolvedValue([{ name: 'POS-Printer', address: 'AA:BB:CC:DD:EE:FF', bonded: true }]);
      BT.startDiscovery.mockRejectedValue(new Error('discovery failed'));
      const results = await scanBluetoothPrinters();
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'POS-Printer', paired: true });
    });

    it('always cancels discovery, even on success', async () => {
      await scanBluetoothPrinters();
      expect(BT.cancelDiscovery).toHaveBeenCalled();
    });
  });

  // ── Permissions ─────────────────────────────────────────────────────────────

  describe('permission denials', () => {
    it('throws BluetoothPreconditionError with app-settings when BLUETOOTH_SCAN denied (API 31+)', async () => {
      (PermissionsAndroid.requestMultiple as jest.Mock).mockResolvedValue({
        [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]:    PermissionsAndroid.RESULTS.DENIED,
        [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]: PermissionsAndroid.RESULTS.GRANTED,
      });
      const err = await scanBluetoothPrinters().catch(e => e);
      expect(err).toBeInstanceOf(BluetoothPreconditionError);
      expect(err.settingsIntent).toBe('app-settings');
    });

    it('throws BluetoothPreconditionError with app-settings when BLUETOOTH_CONNECT denied (API 31+)', async () => {
      (PermissionsAndroid.requestMultiple as jest.Mock).mockResolvedValue({
        [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]:    PermissionsAndroid.RESULTS.GRANTED,
        [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]: PermissionsAndroid.RESULTS.DENIED,
      });
      const err = await scanBluetoothPrinters().catch(e => e);
      expect(err).toBeInstanceOf(BluetoothPreconditionError);
      expect(err.settingsIntent).toBe('app-settings');
    });

    it('throws BluetoothPreconditionError with app-settings when location denied (API 30)', async () => {
      setPlatform('android', 30);
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
      const err = await scanBluetoothPrinters().catch(e => e);
      expect(err).toBeInstanceOf(BluetoothPreconditionError);
      expect(err.settingsIntent).toBe('app-settings');
    });

    it('does not throw when all permissions are granted (API 31+)', async () => {
      await expect(scanBluetoothPrinters()).resolves.not.toThrow();
    });

    it('does not check permissions on iOS', async () => {
      setPlatform('ios', 17);
      await scanBluetoothPrinters();
      expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
      expect(PermissionsAndroid.request).not.toHaveBeenCalled();
    });
  });

  // ── Result parsing ───────────────────────────────────────────────────────────

  describe('result parsing', () => {
    it('maps bonded devices as paired', async () => {
      BT.getBondedDevices.mockResolvedValue([{ name: 'POS-Printer', address: 'AA:BB:CC:DD:EE:FF', bonded: true }]);
      const results = await scanBluetoothPrinters();
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        name: 'POS-Printer', address: 'AA:BB:CC:DD:EE:FF',
        type: 'bluetooth', paired: true,
      });
    });

    it('maps discovered (unpaired nearby) devices', async () => {
      BT.startDiscovery.mockResolvedValue([{ name: 'XP-58', address: '11:22:33:44:55:66' }]);
      const results = await scanBluetoothPrinters();
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'XP-58', paired: false });
    });

    it('returns both paired and discovered devices together', async () => {
      BT.getBondedDevices.mockResolvedValue([{ name: 'Paired-A', address: 'AA:AA:AA:AA:AA:AA' }]);
      BT.startDiscovery.mockResolvedValue([{ name: 'Found-B', address: 'BB:BB:BB:BB:BB:BB' }]);
      const results = await scanBluetoothPrinters();
      expect(results).toHaveLength(2);
      expect(results.find(r => r.name === 'Paired-A')?.paired).toBe(true);
      expect(results.find(r => r.name === 'Found-B')?.paired).toBe(false);
    });

    it('dedupes a device that appears in both bonded and discovery (bonded wins)', async () => {
      BT.getBondedDevices.mockResolvedValue([{ name: 'POS-Printer', address: 'AA:BB:CC:DD:EE:FF' }]);
      BT.startDiscovery.mockResolvedValue([{ name: 'POS-Printer', address: 'AA:BB:CC:DD:EE:FF' }]);
      const results = await scanBluetoothPrinters();
      expect(results).toHaveLength(1);
      expect(results[0].paired).toBe(true);
    });

    it('returns [] when scan finds nothing', async () => {
      await expect(scanBluetoothPrinters()).resolves.toEqual([]);
    });

    it('falls back to address when device name is absent', async () => {
      BT.getBondedDevices.mockResolvedValue([{ name: '', address: 'AA:BB:CC:DD:EE:FF' }]);
      const results = await scanBluetoothPrinters();
      expect(results[0].name).toBe('AA:BB:CC:DD:EE:FF');
    });
  });
});

// ─── printBytes — bluetooth path ──────────────────────────────────────────────

describe('printBytes (bluetooth)', () => {
  const DEVICE  = 'POS-Printer';
  const ADDRESS = 'AA:BB:CC:DD:EE:FF';
  const BYTES   = new Uint8Array([0x1b, 0x40, 0x0a]);

  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform('android', 31);
    grantPermissions();
    BT.isBluetoothEnabled.mockResolvedValue(true);
    BT.getBondedDevices.mockResolvedValue([{ name: DEVICE, address: ADDRESS, bonded: true }]);
    BT.isDeviceConnected.mockResolvedValue(false);
    BT.cancelDiscovery.mockResolvedValue(true);
    BT.getConnectedDevices.mockResolvedValue([]);
    BT.disconnectFromDevice.mockResolvedValue(true);
    BT.connectToDevice.mockResolvedValue({ name: DEVICE, address: ADDRESS });
    BT.writeToDevice.mockResolvedValue(true);
  });

  it('throws BluetoothPreconditionError when Bluetooth is off and the user declines', async () => {
    BT.isBluetoothEnabled.mockResolvedValue(false);
    BT.requestBluetoothEnabled.mockResolvedValue(false);
    const err = await printBytes(BYTES, { type: 'bluetooth', btDevice: DEVICE }).catch(e => e);
    expect(err).toBeInstanceOf(BluetoothPreconditionError);
    expect(err.settingsIntent).toBe('android.settings.BLUETOOTH_SETTINGS');
  });

  it('throws a plain Error (not BluetoothPreconditionError) when the device is not paired', async () => {
    BT.getBondedDevices.mockResolvedValue([]);
    const err = await printBytes(BYTES, { type: 'bluetooth', btDevice: DEVICE }).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BluetoothPreconditionError);
    expect(err.message).toMatch(/not paired/i);
  });

  it('connects to the device MAC and writes the ESC/POS bytes as base64', async () => {
    await printBytes(BYTES, { type: 'bluetooth', btDevice: DEVICE });
    expect(BT.connectToDevice).toHaveBeenCalledWith(ADDRESS, { secureSocket: false });
    expect(BT.writeToDevice).toHaveBeenCalledWith(ADDRESS, expect.any(String), 'base64');
    // The base64 payload must decode back to the exact ESC/POS bytes.
    const sent = BT.writeToDevice.mock.calls[0][1];
    expect(Array.from(Buffer.from(sent, 'base64'))).toEqual([0x1b, 0x40, 0x0a]);
  });

  it('cancels any in-progress discovery before connecting', async () => {
    const order: string[] = [];
    BT.cancelDiscovery.mockImplementation(() => { order.push('cancel'); return Promise.resolve(true); });
    BT.connectToDevice.mockImplementation(() => { order.push('connect'); return Promise.resolve({ name: DEVICE, address: ADDRESS }); });
    await printBytes(BYTES, { type: 'bluetooth', btDevice: DEVICE });
    expect(BT.cancelDiscovery).toHaveBeenCalled();
    expect(order).toEqual(['cancel', 'connect']);
  });

  it('disconnects another open printer before connecting this one', async () => {
    const OTHER = '11:22:33:44:55:66';
    BT.getConnectedDevices.mockResolvedValue([{ name: 'Receipt', address: OTHER }]);
    await printBytes(BYTES, { type: 'bluetooth', btDevice: DEVICE });
    expect(BT.disconnectFromDevice).toHaveBeenCalledWith(OTHER);
    expect(BT.connectToDevice).toHaveBeenCalledWith(ADDRESS, { secureSocket: false });
  });

  it('does not disconnect the target printer if it is already in the connected list', async () => {
    BT.getConnectedDevices.mockResolvedValue([{ name: DEVICE, address: ADDRESS }]);
    await printBytes(BYTES, { type: 'bluetooth', btDevice: DEVICE });
    expect(BT.disconnectFromDevice).not.toHaveBeenCalledWith(ADDRESS);
  });

  it('falls back to a secure socket when the insecure connection fails', async () => {
    BT.connectToDevice
      .mockRejectedValueOnce(new Error('read failed, socket might closed or timeout, read ret: -1'))
      .mockResolvedValueOnce({ name: DEVICE, address: ADDRESS });
    await printBytes(BYTES, { type: 'bluetooth', btDevice: DEVICE });
    expect(BT.connectToDevice).toHaveBeenNthCalledWith(1, ADDRESS, { secureSocket: false });
    expect(BT.connectToDevice).toHaveBeenNthCalledWith(2, ADDRESS, { secureSocket: true });
    expect(BT.writeToDevice).toHaveBeenCalled();
  });

  it('surfaces the original insecure error when both socket types fail', async () => {
    BT.connectToDevice.mockRejectedValue(new Error('insecure boom'));
    const err = await printBytes(BYTES, { type: 'bluetooth', btDevice: DEVICE }).catch(e => e);
    expect(err.message).toMatch(/insecure boom/);
    expect(BT.writeToDevice).not.toHaveBeenCalled();
  });

  it('skips the connect call when the device is already connected', async () => {
    BT.isDeviceConnected.mockResolvedValue(true);
    await printBytes(BYTES, { type: 'bluetooth', btDevice: DEVICE });
    expect(BT.connectToDevice).not.toHaveBeenCalled();
    expect(BT.writeToDevice).toHaveBeenCalled();
  });

  it('finds the device by address when the configured name does not match', async () => {
    BT.getBondedDevices.mockResolvedValue([{ name: 'Other', address: ADDRESS }]);
    await printBytes(BYTES, { type: 'bluetooth', btDevice: ADDRESS });
    expect(BT.connectToDevice).toHaveBeenCalledWith(ADDRESS, { secureSocket: false });
  });

  it('skips print when bytes array is empty', async () => {
    await printBytes(new Uint8Array(0), { type: 'bluetooth', btDevice: DEVICE });
    expect(BT.getBondedDevices).not.toHaveBeenCalled();
  });

  it('throws plain Error when btDevice is not configured', async () => {
    const err = await printBytes(BYTES, { type: 'bluetooth' }).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BluetoothPreconditionError);
    expect(err.message).toMatch(/not configured/i);
  });
});
