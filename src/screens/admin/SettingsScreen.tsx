import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { AppModal, useToast } from '../../components/ui';
import AdminLayout from './AdminLayout';
import { getSettings, saveSettings, clearPrinterSettings } from '../../firebase/firestoreService';
import { PaperWidth, Settings } from '../../types';
import { buildTestPage } from '../../utils/printerTemplates';
import { printBytes, scanWifiPrinters, scanBluetoothPrinters, disconnectBluetoothPrinter, BluetoothPreconditionError, DiscoveredPrinter } from '../../services/printerService';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

// ─── Printer model catalogue ──────────────────────────────────────────────────

const PRINTER_MODELS: { key: string; label: string; detail: string }[] = [
  { key: 'epson_tm',  label: 'Epson TM series',    detail: 'TM-T20, TM-T82, TM-T88' },
  { key: 'star_tsp',  label: 'Star TSP / mC-Print', detail: 'TSP100, mC-Print2, mC-Print3' },
  { key: 'bixolon',   label: 'Bixolon SPP series',  detail: 'SPP-R200, SPP-R300, SPP-R310' },
  { key: 'xprinter',  label: 'Xprinter XP series',  detail: 'XP-58, XP-80, XP-N160II' },
  { key: 'citizen',   label: 'Citizen CT series',   detail: 'CT-S310, CT-S651, CT-D150' },
  { key: 'generic',   label: 'Generic ESC/POS',     detail: 'Any ESC/POS-compatible printer' },
];

type PrinterType = 'wifi' | 'bluetooth';

interface PrinterState {
  type:  PrinterType;
  ip:    string;
  port:  string;
  bt:    string;
  width: PaperWidth;
  model: string;
}

const DEFAULT_PRINTER: PrinterState = {
  type: 'wifi', ip: '', port: '', bt: '', width: '80mm', model: 'generic',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const toast = useToast();

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');

  const [btAlert,            setBtAlert]            = useState<{ message: string; openSettings: () => void } | null>(null);
  const [removePrinterTarget, setRemovePrinterTarget] = useState<'receipt' | 'kitchen' | null>(null);

  // Business info
  const [bizName,    setBizName]    = useState('');
  const [bizAddress, setBizAddress] = useState('');
  const [bizPhone,   setBizPhone]   = useState('');
  const [footer,     setFooter]     = useState('');

  // Printer states
  const [rcpt, setRcpt] = useState<PrinterState>(DEFAULT_PRINTER);
  const [kit,  setKit]  = useState<PrinterState>(DEFAULT_PRINTER);

  // Scan modal
  const [scanTarget,   setScanTarget]   = useState<'receipt' | 'kitchen' | null>(null);
  const [scanning,     setScanning]     = useState(false);
  const [foundPrinters, setFoundPrinters] = useState<DiscoveredPrinter[]>([]);

  // Print test
  const [testTarget, setTestTarget] = useState<'receipt' | 'kitchen' | null>(null);

  // Tab
  const [activeTab, setActiveTab] = useState<'general' | 'receipt' | 'kitchen'>('general');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const s = await getSettings();
      setBizName(s.business_name    ?? '');
      setBizAddress(s.business_address ?? '');
      setBizPhone(s.business_phone   ?? '');
      setFooter(s.receipt_footer     ?? '');

      setRcpt({
        type:  (s.receipt_printer_type  ?? 'wifi') as PrinterType,
        ip:    s.receipt_printer_ip    ?? '',
        port:  s.receipt_printer_port  != null ? String(s.receipt_printer_port) : '',
        bt:    s.receipt_printer_bt    ?? '',
        width: (s.receipt_paper_width  ?? '80mm') as PaperWidth,
        model: s.receipt_printer_model ?? 'generic',
      });
      setKit({
        type:  (s.kitchen_printer_type  ?? 'wifi') as PrinterType,
        ip:    s.kitchen_printer_ip    ?? '',
        port:  s.kitchen_printer_port  != null ? String(s.kitchen_printer_port) : '',
        bt:    s.kitchen_printer_bt    ?? '',
        width: (s.kitchen_paper_width  ?? '80mm') as PaperWidth,
        model: s.kitchen_printer_model ?? 'generic',
      });
    } catch {
      setError('Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }

  function parsePort(raw: string): number | undefined {
    const n = parseInt(raw.trim(), 10);
    return isNaN(n) || n < 1 || n > 65535 ? undefined : n;
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError('');

    if (rcpt.type === 'wifi' && rcpt.port.trim()) {
      if (parsePort(rcpt.port) === undefined) {
        setError('Receipt printer port must be 1–65535.'); setSaving(false); return;
      }
    }
    if (kit.type === 'wifi' && kit.port.trim()) {
      if (parsePort(kit.port) === undefined) {
        setError('Kitchen printer port must be 1–65535.'); setSaving(false); return;
      }
    }

    const settings: Settings = {
      business_name:          bizName.trim()    || undefined,
      business_address:       bizAddress.trim() || undefined,
      business_phone:         bizPhone.trim()   || undefined,
      receipt_footer:         footer.trim()     || undefined,
      receipt_printer_type:   rcpt.type,
      receipt_printer_ip:     rcpt.type === 'wifi'      ? rcpt.ip.trim()  || undefined : undefined,
      receipt_printer_port:   rcpt.type === 'wifi'      ? parsePort(rcpt.port) : undefined,
      receipt_printer_bt:     rcpt.type === 'bluetooth' ? rcpt.bt.trim()  || undefined : undefined,
      receipt_paper_width:    rcpt.width,
      receipt_printer_model:  rcpt.model || undefined,
      kitchen_printer_type:   kit.type,
      kitchen_printer_ip:     kit.type === 'wifi'       ? kit.ip.trim()   || undefined : undefined,
      kitchen_printer_port:   kit.type === 'wifi'       ? parsePort(kit.port) : undefined,
      kitchen_printer_bt:     kit.type === 'bluetooth'  ? kit.bt.trim()   || undefined : undefined,
      kitchen_paper_width:    kit.width,
      kitchen_printer_model:  kit.model || undefined,
    };

    try {
      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      const msg = (e as { code?: string }).code === 'permission-denied'
        ? 'Permission denied.'
        : 'Failed to save. Check your connection.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  // ── Bluetooth precondition alert ───────────────────────────────────────────

  function alertPrecondition(e: BluetoothPreconditionError) {
    const openSettings = e.settingsIntent === 'app-settings'
      ? () => Linking.openSettings()
      : () => Linking.sendIntent(e.settingsIntent);
    setBtAlert({ message: e.message, openSettings });
  }

  // ── Scan modal ─────────────────────────────────────────────────────────────

  async function openScan(target: 'receipt' | 'kitchen') {
    const printer = target === 'receipt' ? rcpt : kit;
    setScanTarget(target);
    setFoundPrinters([]);
    setScanning(true);
    try {
      const results = printer.type === 'wifi'
        ? await scanWifiPrinters()
        : await scanBluetoothPrinters();
      setFoundPrinters(results);
    } catch (e: unknown) {
      setScanTarget(null);
      if (e instanceof BluetoothPreconditionError) alertPrecondition(e);
      else toast.error((e as Error).message ?? 'Scan failed. Unknown error.');
    } finally {
      setScanning(false);
    }
  }

  function selectDiscoveredPrinter(p: DiscoveredPrinter) {
    const patch: Partial<PrinterState> =
      p.type === 'wifi'
        ? { ip: p.address, port: '9100' }
        : { bt: p.name };

    if (scanTarget === 'receipt') setRcpt((prev) => ({ ...prev, ...patch }));
    else                          setKit ((prev) => ({ ...prev, ...patch }));
    setScanTarget(null);
  }

  // ── Print test ─────────────────────────────────────────────────────────────

  async function handlePrintTest(target: 'receipt' | 'kitchen') {
    setTestTarget(target);
    const printer = target === 'receipt' ? rcpt : kit;
    const settings: Settings = {
      business_name:       bizName.trim() || undefined,
      receipt_paper_width: rcpt.width,
      kitchen_paper_width: kit.width,
    };
    try {
      const bytes = buildTestPage(settings, target);
      await printBytes(bytes, {
        type:     printer.type,
        ip:       printer.ip  || undefined,
        port:     parsePort(printer.port),
        btDevice: printer.bt  || undefined,
      });
    } catch (e: unknown) {
      if (e instanceof BluetoothPreconditionError) alertPrecondition(e);
      else toast.error((e as Error).message ?? 'Print test failed. Unknown error.');
    } finally {
      setTestTarget(null);
    }
  }

  // ── Remove printer ─────────────────────────────────────────────────────────

  function handleRemovePrinter(target: 'receipt' | 'kitchen') {
    setRemovePrinterTarget(target);
  }

  async function doRemovePrinter(target: 'receipt' | 'kitchen') {
    const printer = target === 'receipt' ? rcpt : kit;
    if (printer.type === 'bluetooth' && printer.bt) {
      await disconnectBluetoothPrinter(printer.bt);
    }
    try {
      await clearPrinterSettings(target);
      if (target === 'receipt') setRcpt(DEFAULT_PRINTER);
      else                      setKit(DEFAULT_PRINTER);
    } catch {
      toast.error('Could not remove the printer. Check your connection and try again.');
    }
  }

  if (loading) {
    return (
      <AdminLayout active="Settings">
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.green600} />
        </View>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout active="Settings">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'android' ? 'height' : 'padding'}
      >
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Page header */}
          <View style={s.pageHeader}>
            <Text style={s.pageTitle}>Settings</Text>
            <View style={s.saveRow}>
              {!!error && (
                <View style={s.errorInline}>
                  <Text style={s.errorText}>{error}</Text>
                </View>
              )}
              {saved && <Text style={s.savedText}>✓ Saved</Text>}
              <TouchableOpacity
                style={[s.discardBtn, saving && s.btnOff]}
                onPress={load}
                disabled={saving}
                activeOpacity={0.8}
              >
                <Text style={s.discardBtnText}>Discard Changes</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, saving && s.btnOff]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={s.saveBtnText}>Save Changes</Text>
                }
              </TouchableOpacity>
            </View>
          </View>

          {/* Tab bar */}
          <View style={s.tabBar}>
            {([
              { key: 'general', label: 'General' },
              { key: 'receipt', label: 'Receipt Printer' },
              { key: 'kitchen', label: 'Kitchen Printer' },
            ] as { key: typeof activeTab; label: string }[]).map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[s.tab, activeTab === key && s.tabActive]}
                onPress={() => setActiveTab(key)}
                activeOpacity={0.7}
              >
                <Text style={[s.tabText, activeTab === key && s.tabTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* General tab — business info + receipt footer */}
          {activeTab === 'general' && (
            <>
              <Section title="Business Info">
                <Field label="Business Name">
                  <TextInput style={s.input} value={bizName} onChangeText={setBizName}
                    placeholder="SmartBrew Café" placeholderTextColor={Colors.gray400} />
                </Field>
                <Field label="Address">
                  <TextInput style={s.input} value={bizAddress} onChangeText={setBizAddress}
                    placeholder="123 Main St, City" placeholderTextColor={Colors.gray400} />
                </Field>
                <Field label="Phone">
                  <TextInput style={s.input} value={bizPhone} onChangeText={setBizPhone}
                    placeholder="+63 900 000 0000" placeholderTextColor={Colors.gray400}
                    keyboardType="phone-pad" />
                </Field>
              </Section>

              <Section title="Receipt">
                <Field label="Footer Text" hint="Printed at the bottom of every receipt">
                  <TextInput style={[s.input, s.multiline]} value={footer} onChangeText={setFooter}
                    placeholder="Thank you for visiting!" placeholderTextColor={Colors.gray400}
                    multiline numberOfLines={3} />
                </Field>
              </Section>
            </>
          )}

          {/* Receipt Printer tab */}
          {activeTab === 'receipt' && (
            <PrinterSection
              title="Receipt Printer"
              printer={rcpt}
              onChange={setRcpt}
              onScan={() => openScan('receipt')}
              onTest={() => handlePrintTest('receipt')}
              onRemove={() => handleRemovePrinter('receipt')}
              testing={testTarget === 'receipt'}
            />
          )}

          {/* Kitchen Printer tab */}
          {activeTab === 'kitchen' && (
            <PrinterSection
              title="Kitchen Printer"
              printer={kit}
              onChange={setKit}
              onScan={() => openScan('kitchen')}
              onTest={() => handlePrintTest('kitchen')}
              onRemove={() => handleRemovePrinter('kitchen')}
              testing={testTarget === 'kitchen'}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Scan Modal */}
      <ScanModal
        visible={scanTarget !== null}
        printerType={scanTarget === 'receipt' ? rcpt.type : kit.type}
        scanning={scanning}
        found={foundPrinters}
        onSelect={selectDiscoveredPrinter}
        onClose={() => setScanTarget(null)}
      />

      {btAlert && (
        <AppModal
          visible
          variant="confirm"
          title="Bluetooth Unavailable"
          body={btAlert.message}
          confirmText="Open Settings"
          cancelText="Cancel"
          onCancel={() => setBtAlert(null)}
          onConfirm={() => { setBtAlert(null); btAlert.openSettings(); }}
        />
      )}

      {removePrinterTarget && (
        <AppModal
          visible
          variant="confirm"
          danger
          title="Remove Printer"
          body={`This clears the ${removePrinterTarget} printer configuration and disconnects it, so you can set it up from scratch.`}
          confirmText="Remove"
          onCancel={() => setRemovePrinterTarget(null)}
          onConfirm={() => {
            const t = removePrinterTarget;
            setRemovePrinterTarget(null);
            doRemovePrinter(t);
          }}
        />
      )}
    </AdminLayout>
  );
}

// ─── PrinterSection ───────────────────────────────────────────────────────────

function PrinterSection({
  title, printer, onChange, onScan, onTest, onRemove, testing,
}: {
  title:    string;
  printer:  PrinterState;
  onChange: (p: PrinterState) => void;
  onScan:   () => void;
  onTest:   () => void;
  onRemove: () => void;
  testing:  boolean;
}) {
  const set = (patch: Partial<PrinterState>) => onChange({ ...printer, ...patch });
  const configured = printer.type === 'wifi' ? printer.ip : printer.bt;

  return (
    <Section title={title}>
      {/* Connection type */}
      <Field label="Connection Type">
        <TypeToggle value={printer.type} onChange={(t) => set({ type: t })} />
      </Field>

      {/* Search button + current device */}
      <View style={ps.searchRow}>
        <View style={{ flex: 1 }}>
          <Text style={ps.deviceLabel}>
            {configured
              ? printer.type === 'wifi'
                ? `${printer.ip}:${printer.port || 9100}`
                : printer.bt
              : 'No printer configured'}
          </Text>
          {configured ? (
            <Text style={ps.deviceSub}>
              {PRINTER_MODELS.find((m) => m.key === printer.model)?.label ?? 'Generic ESC/POS'}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity style={ps.scanBtn} onPress={onScan} activeOpacity={0.8}>
          <Text style={ps.scanBtnText}>🔍 Search</Text>
        </TouchableOpacity>
      </View>

      {/* Manual entry */}
      {printer.type === 'wifi' ? (
        <View style={ps.manualRow}>
          <View style={{ flex: 2 }}>
            <Field label="IP Address" hint="e.g. 192.168.1.200">
              <TextInput style={s.input} value={printer.ip}
                onChangeText={(v) => set({ ip: v })}
                placeholder="192.168.1.200" placeholderTextColor={Colors.gray400}
                keyboardType="numeric" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Port" hint="Default 9100">
              <TextInput style={s.input} value={printer.port}
                onChangeText={(v) => set({ port: v })}
                placeholder="9100" placeholderTextColor={Colors.gray400}
                keyboardType="numeric" />
            </Field>
          </View>
        </View>
      ) : (
        <Field label="Bluetooth Device Name" hint="Exact name shown in device Bluetooth settings">
          <TextInput style={s.input} value={printer.bt}
            onChangeText={(v) => set({ bt: v })}
            placeholder="POS-Printer" placeholderTextColor={Colors.gray400} />
        </Field>
      )}

      {/* Printer model */}
      <Field label="Printer Model">
        <View style={ps.modelGrid}>
          {PRINTER_MODELS.map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[ps.modelBtn, printer.model === m.key && ps.modelBtnSel]}
              onPress={() => set({ model: m.key })}
              activeOpacity={0.7}
            >
              <Text style={[ps.modelLabel, printer.model === m.key && ps.modelLabelSel]}>
                {m.label}
              </Text>
              <Text style={[ps.modelDetail, printer.model === m.key && ps.modelDetailSel]}>
                {m.detail}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Field>

      {/* Paper width */}
      <Field label="Paper Width">
        <WidthToggle value={printer.width} onChange={(w) => set({ width: w })} />
      </Field>

      {/* Print test */}
      <TouchableOpacity
        style={[ps.testBtn, testing && ps.testBtnOff]}
        onPress={onTest}
        disabled={testing}
        activeOpacity={0.8}
      >
        {testing
          ? <ActivityIndicator color={Colors.white} size="small" />
          : <Text style={ps.testBtnText}>🖨️ Print Test</Text>
        }
      </TouchableOpacity>

      {/* Remove printer — only when something is configured */}
      {configured ? (
        <TouchableOpacity style={ps.removeBtn} onPress={onRemove} activeOpacity={0.8}>
          <Text style={ps.removeBtnText}>Remove Printer</Text>
        </TouchableOpacity>
      ) : null}
    </Section>
  );
}

// ─── ScanModal ────────────────────────────────────────────────────────────────

function ScanModal({
  visible, printerType, scanning, found, onSelect, onClose,
}: {
  visible:     boolean;
  printerType: PrinterType;
  scanning:    boolean;
  found:       DiscoveredPrinter[];
  onSelect:    (p: DiscoveredPrinter) => void;
  onClose:     () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={sm.overlay}>
        <View style={sm.sheet}>
          {/* Header */}
          <View style={sm.header}>
            <View style={{ flex: 1 }}>
              <Text style={sm.title}>
                {printerType === 'wifi' ? '📶 WiFi Printers' : '🔵 Bluetooth Printers'}
              </Text>
              <Text style={sm.subtitle}>
                {scanning
                  ? 'Scanning your network…'
                  : found.length > 0
                  ? `${found.length} printer${found.length !== 1 ? 's' : ''} found`
                  : 'No printers found automatically'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12} activeOpacity={0.7}>
              <Text style={sm.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Body */}
          <ScrollView style={sm.body} contentContainerStyle={sm.bodyContent}>
            {scanning ? (
              <View style={sm.scanningBox}>
                <ActivityIndicator size="large" color={Colors.green600} />
                <Text style={sm.scanningText}>
                  {printerType === 'wifi'
                    ? 'Searching for printers on your network via mDNS…'
                    : 'Scanning for Bluetooth printers nearby…'}
                </Text>
                <Text style={sm.scanningHint}>This may take a few seconds.</Text>
              </View>
            ) : found.length > 0 ? (
              found.map((p, i) => (
                <TouchableOpacity
                  key={i}
                  style={sm.printerRow}
                  onPress={() => onSelect(p)}
                  activeOpacity={0.7}
                >
                  <View style={sm.printerIcon}>
                    <Text style={sm.printerIconText}>
                      {p.type === 'wifi' ? '📶' : '🔵'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={sm.printerName}>{p.name}</Text>
                    <Text style={sm.printerAddr}>
                      {p.address}
                      {p.paired === false ? '  •  not paired' : ''}
                      {p.paired === true  ? '  •  paired'     : ''}
                    </Text>
                  </View>
                  <Text style={sm.selectText}>Select ›</Text>
                </TouchableOpacity>
              ))
            ) : (
              <View style={sm.emptyBox}>
                <Text style={sm.emptyTitle}>No printers found</Text>
                <Text style={sm.emptyBody}>
                  {printerType === 'wifi'
                    ? 'Make sure the printer is powered on and connected to the same WiFi network. You can also enter the IP address manually.'
                    : 'Make sure the printer is powered on and Bluetooth is enabled on this device. You may need to pair it in your device\'s Bluetooth settings first.'}
                </Text>
                {Platform.OS === 'web' && (
                  <View style={sm.nativeBadge}>
                    <Text style={sm.nativeBadgeText}>
                      ⚠ Printer scanning requires the native Android/iOS app.
                      {'\n'}Run npx expo prebuild and rebuild to enable.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={sm.footer}>
            <Text style={sm.footerHint}>
              Not finding your printer? Enter the {printerType === 'wifi' ? 'IP address' : 'device name'} manually above.
            </Text>
            <TouchableOpacity style={sm.closeBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={sm.closeBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sec.root}>
      <Text style={sec.title}>{title}</Text>
      <View style={sec.card}>{children}</View>
    </View>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={fld.root}>
      <Text style={fld.label}>{label}</Text>
      {!!hint && <Text style={fld.hint}>{hint}</Text>}
      {children}
    </View>
  );
}

function TypeToggle({ value, onChange }: { value: PrinterType; onChange: (v: PrinterType) => void }) {
  return (
    <View style={tt.row}>
      {(['wifi', 'bluetooth'] as PrinterType[]).map((t) => (
        <TouchableOpacity key={t} style={[tt.btn, value === t && tt.btnSel]}
          onPress={() => onChange(t)} activeOpacity={0.7}>
          <Text style={[tt.text, value === t && tt.textSel]}>
            {t === 'wifi' ? '📶 WiFi' : '🔵 Bluetooth'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function WidthToggle({ value, onChange }: { value: PaperWidth; onChange: (v: PaperWidth) => void }) {
  return (
    <View style={tt.row}>
      {(['58mm', '80mm'] as PaperWidth[]).map((w) => (
        <TouchableOpacity key={w} style={[tt.btn, value === w && tt.btnSel]}
          onPress={() => onChange(w)} activeOpacity={0.7}>
          <Text style={[tt.text, value === w && tt.textSel]}>
            {w === '58mm' ? '58 mm  (32 cols)' : '80 mm  (48 cols)'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: Colors.background },
  content:  { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  center:   { flex: 1, justifyContent: 'center', alignItems: 'center' },

  pageHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', flexWrap: 'wrap', gap: Spacing.md,
  },
  pageTitle: { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: Colors.gray900 },
  saveRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexWrap: 'wrap' },

  errorInline: {
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    maxWidth: 280,
    flexShrink: 1,
  },
  errorText:      { fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.medium },
  savedText:      { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.semibold },

  discardBtn: {
    borderWidth: 1.5, borderColor: Colors.gray300, borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    alignItems: 'center', backgroundColor: Colors.surface,
  },
  discardBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.gray600 },

  saveBtn: {
    backgroundColor: Colors.green600, borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    minWidth: 130, alignItems: 'center', ...Shadow.sm,
  },
  saveBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },
  btnOff:      { opacity: 0.6 },

  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.base, color: Colors.gray800, backgroundColor: Colors.white,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xs,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  tabActive:     { backgroundColor: Colors.green600 },
  tabText:       { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray600 },
  tabTextActive: { color: Colors.white, fontWeight: FontWeight.bold },
});

const sec = StyleSheet.create({
  root:  { gap: Spacing.sm },
  title: {
    fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray500,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.xl, gap: Spacing.lg, ...Shadow.sm,
  },
});

const fld = StyleSheet.create({
  root:  { gap: Spacing.xs },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  hint:  { fontSize: FontSize.xs, color: Colors.gray400 },
});

const tt = StyleSheet.create({
  row:     { flexDirection: 'row', gap: Spacing.sm },
  btn:     {
    flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  btnSel:  { borderColor: Colors.green600, backgroundColor: Colors.green50 },
  text:    { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray600 },
  textSel: { color: Colors.green700, fontWeight: FontWeight.bold },
});

const ps = StyleSheet.create({
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.gray50, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  deviceLabel: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray800 },
  deviceSub:   { fontSize: FontSize.xs, color: Colors.gray500, marginTop: 2 },
  scanBtn: {
    backgroundColor: Colors.green600, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, ...Shadow.sm,
  },
  scanBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.white },

  manualRow: { flexDirection: 'row', gap: Spacing.md },

  modelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  modelBtn: {
    minWidth: '45%', flex: 1, padding: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, gap: 2,
  },
  modelBtnSel:    { borderColor: Colors.green600, backgroundColor: Colors.green50 },
  modelLabel:     { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  modelLabelSel:  { color: Colors.green700 },
  modelDetail:    { fontSize: FontSize.xs, color: Colors.gray400 },
  modelDetailSel: { color: Colors.green600 },

  testBtn: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  testBtnOff:  { opacity: 0.6 },
  testBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray700 },

  removeBtn: {
    borderWidth: 1.5,
    borderColor: Colors.danger + '55',
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    backgroundColor: Colors.dangerBg,
  },
  removeBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.danger },
});

const sm = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', padding: Spacing.xl,
  },
  sheet: {
    width: '100%', maxWidth: 520, height: '80%',
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    overflow: 'hidden', ...Shadow.lg,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: Spacing.xl, gap: Spacing.md,
    backgroundColor: Colors.green700,
  },
  title:    { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  subtitle: { fontSize: FontSize.sm, color: Colors.green200, marginTop: 2 },
  closeX:   { fontSize: FontSize.xl, color: Colors.white, fontWeight: FontWeight.bold },

  body:        { flex: 1 },
  bodyContent: { padding: Spacing.lg, gap: Spacing.sm },

  scanningBox: {
    paddingVertical: Spacing.xxxl, alignItems: 'center', gap: Spacing.lg,
  },
  scanningText: {
    fontSize: FontSize.base, color: Colors.gray700,
    textAlign: 'center', fontWeight: FontWeight.medium,
  },
  scanningHint: { fontSize: FontSize.sm, color: Colors.gray400, textAlign: 'center' },

  printerRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg,
  },
  printerIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.green50,
    alignItems: 'center', justifyContent: 'center',
  },
  printerIconText: { fontSize: 18 },
  printerName:     { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray900 },
  printerAddr:     { fontSize: FontSize.xs, color: Colors.gray500, marginTop: 2 },
  selectText:      { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.semibold },

  emptyBox: {
    paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.gray700 },
  emptyBody: {
    fontSize: FontSize.sm, color: Colors.gray500,
    textAlign: 'center', lineHeight: 20,
  },
  nativeBadge: {
    backgroundColor: Colors.warningBg, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.warning + '44',
    marginTop: Spacing.sm,
  },
  nativeBadgeText: {
    fontSize: FontSize.xs, color: Colors.warning,
    fontWeight: FontWeight.medium, textAlign: 'center', lineHeight: 18,
  },

  footer: {
    borderTopWidth: 1, borderColor: Colors.border,
    padding: Spacing.lg, gap: Spacing.md,
    backgroundColor: Colors.surface,
  },
  footerHint: { fontSize: FontSize.xs, color: Colors.gray400, textAlign: 'center' },
  closeBtn: {
    backgroundColor: Colors.green600, borderRadius: Radius.md,
    paddingVertical: Spacing.md, alignItems: 'center',
  },
  closeBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },
});
