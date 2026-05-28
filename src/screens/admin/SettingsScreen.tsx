import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import AdminLayout from './AdminLayout';
import { getSettings, saveSettings } from '../../firebase/firestoreService';
import { PaperWidth, Settings } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type PrinterType = 'wifi' | 'bluetooth';

export default function SettingsScreen() {
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');

  // Business
  const [bizName,    setBizName]    = useState('');
  const [bizAddress, setBizAddress] = useState('');
  const [bizPhone,   setBizPhone]   = useState('');
  const [footer,     setFooter]     = useState('');

  // Receipt printer
  const [rcptType,  setRcptType]  = useState<PrinterType>('wifi');
  const [rcptIp,    setRcptIp]    = useState('');
  const [rcptPort,  setRcptPort]  = useState('');
  const [rcptBt,    setRcptBt]    = useState('');
  const [rcptWidth, setRcptWidth] = useState<PaperWidth>('80mm');

  // Kitchen printer
  const [kitType,  setKitType]  = useState<PrinterType>('wifi');
  const [kitIp,    setKitIp]    = useState('');
  const [kitPort,  setKitPort]  = useState('');
  const [kitBt,    setKitBt]    = useState('');
  const [kitWidth, setKitWidth] = useState<PaperWidth>('80mm');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const s = await getSettings();
      setBizName(s.business_name    ?? '');
      setBizAddress(s.business_address ?? '');
      setBizPhone(s.business_phone   ?? '');
      setFooter(s.receipt_footer     ?? '');
      setRcptType(s.receipt_printer_type   ?? 'wifi');
      setRcptIp(s.receipt_printer_ip     ?? '');
      setRcptPort(s.receipt_printer_port != null ? String(s.receipt_printer_port) : '');
      setRcptBt(s.receipt_printer_bt     ?? '');
      setRcptWidth(s.receipt_paper_width  ?? '80mm');
      setKitType(s.kitchen_printer_type   ?? 'wifi');
      setKitIp(s.kitchen_printer_ip      ?? '');
      setKitPort(s.kitchen_printer_port  != null ? String(s.kitchen_printer_port) : '');
      setKitBt(s.kitchen_printer_bt      ?? '');
      setKitWidth(s.kitchen_paper_width   ?? '80mm');
    } catch {
      setError('Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }

  function parsePort(raw: string): number | undefined {
    const n = parseInt(raw.trim(), 10);
    if (isNaN(n) || n < 1 || n > 65535) return undefined;
    return n;
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError('');

    // Validate ports before saving
    if (rcptType === 'wifi' && rcptPort.trim()) {
      const p = parsePort(rcptPort);
      if (p === undefined) { setError('Receipt printer port must be 1–65535.'); setSaving(false); return; }
    }
    if (kitType === 'wifi' && kitPort.trim()) {
      const p = parsePort(kitPort);
      if (p === undefined) { setError('Kitchen printer port must be 1–65535.'); setSaving(false); return; }
    }

    const settings: Settings = {
      business_name:         bizName.trim()    || undefined,
      business_address:      bizAddress.trim() || undefined,
      business_phone:        bizPhone.trim()   || undefined,
      receipt_footer:        footer.trim()     || undefined,
      receipt_printer_type:  rcptType,
      receipt_printer_ip:    rcptType === 'wifi'      ? rcptIp.trim()  || undefined : undefined,
      receipt_printer_port:  rcptType === 'wifi'      ? parsePort(rcptPort) : undefined,
      receipt_printer_bt:    rcptType === 'bluetooth' ? rcptBt.trim()  || undefined : undefined,
      receipt_paper_width:   rcptWidth,
      kitchen_printer_type:  kitType,
      kitchen_printer_ip:    kitType === 'wifi'      ? kitIp.trim()   || undefined : undefined,
      kitchen_printer_port:  kitType === 'wifi'      ? parsePort(kitPort) : undefined,
      kitchen_printer_bt:    kitType === 'bluetooth' ? kitBt.trim()   || undefined : undefined,
      kitchen_paper_width:   kitWidth,
    };
    try {
      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      const msg = (e as { code?: string }).code === 'permission-denied'
        ? 'Permission denied — contact your administrator.'
        : 'Failed to save. Check your connection.';
      setError(msg);
    } finally {
      setSaving(false);
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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
              {!!error  && <Text style={s.errorText}>{error}</Text>}
              {saved    && <Text style={s.savedText}>✓ Saved</Text>}
              <TouchableOpacity
                style={[s.saveBtn, saving && s.saveBtnOff]}
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

          {/* Business Info */}
          <Section title="Business Info">
            <Field label="Business Name">
              <TextInput
                style={s.input}
                value={bizName}
                onChangeText={setBizName}
                placeholder="SmartBrew Café"
                placeholderTextColor={Colors.gray400}
              />
            </Field>
            <Field label="Address">
              <TextInput
                style={s.input}
                value={bizAddress}
                onChangeText={setBizAddress}
                placeholder="123 Main St, City"
                placeholderTextColor={Colors.gray400}
              />
            </Field>
            <Field label="Phone">
              <TextInput
                style={s.input}
                value={bizPhone}
                onChangeText={setBizPhone}
                placeholder="+63 900 000 0000"
                placeholderTextColor={Colors.gray400}
                keyboardType="phone-pad"
              />
            </Field>
          </Section>

          {/* Receipt */}
          <Section title="Receipt">
            <Field label="Footer Text" hint="Printed at the bottom of every receipt">
              <TextInput
                style={[s.input, s.multiline]}
                value={footer}
                onChangeText={setFooter}
                placeholder="Thank you for visiting!"
                placeholderTextColor={Colors.gray400}
                multiline
                numberOfLines={3}
              />
            </Field>
          </Section>

          {/* Receipt Printer */}
          <Section title="Receipt Printer">
            <Field label="Paper Width">
              <WidthToggle value={rcptWidth} onChange={setRcptWidth} />
            </Field>
            <Field label="Connection Type">
              <TypeToggle value={rcptType} onChange={setRcptType} />
            </Field>
            {rcptType === 'wifi' ? (
              <>
                <Field label="Printer IP Address" hint="e.g. 192.168.1.200">
                  <TextInput
                    style={s.input}
                    value={rcptIp}
                    onChangeText={setRcptIp}
                    placeholder="192.168.1.200"
                    placeholderTextColor={Colors.gray400}
                    keyboardType="numeric"
                  />
                </Field>
                <Field label="Port" hint="Default 9100 — leave blank unless your printer uses a different port">
                  <TextInput
                    style={s.input}
                    value={rcptPort}
                    onChangeText={setRcptPort}
                    placeholder="9100"
                    placeholderTextColor={Colors.gray400}
                    keyboardType="numeric"
                  />
                </Field>
              </>
            ) : (
              <Field label="Bluetooth Device Name" hint="Exact name shown in device Bluetooth settings">
                <TextInput
                  style={s.input}
                  value={rcptBt}
                  onChangeText={setRcptBt}
                  placeholder="POS-Printer"
                  placeholderTextColor={Colors.gray400}
                />
              </Field>
            )}
          </Section>

          {/* Kitchen Printer */}
          <Section title="Kitchen Printer">
            <Field label="Paper Width">
              <WidthToggle value={kitWidth} onChange={setKitWidth} />
            </Field>
            <Field label="Connection Type">
              <TypeToggle value={kitType} onChange={setKitType} />
            </Field>
            {kitType === 'wifi' ? (
              <>
                <Field label="Printer IP Address" hint="e.g. 192.168.1.201">
                  <TextInput
                    style={s.input}
                    value={kitIp}
                    onChangeText={setKitIp}
                    placeholder="192.168.1.201"
                    placeholderTextColor={Colors.gray400}
                    keyboardType="numeric"
                  />
                </Field>
                <Field label="Port" hint="Default 9100 — leave blank unless your printer uses a different port">
                  <TextInput
                    style={s.input}
                    value={kitPort}
                    onChangeText={setKitPort}
                    placeholder="9100"
                    placeholderTextColor={Colors.gray400}
                    keyboardType="numeric"
                  />
                </Field>
              </>
            ) : (
              <Field label="Bluetooth Device Name">
                <TextInput
                  style={s.input}
                  value={kitBt}
                  onChangeText={setKitBt}
                  placeholder="Kitchen-Printer"
                  placeholderTextColor={Colors.gray400}
                />
              </Field>
            )}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </AdminLayout>
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

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={fld.root}>
      <Text style={fld.label}>{label}</Text>
      {!!hint && <Text style={fld.hint}>{hint}</Text>}
      {children}
    </View>
  );
}

function TypeToggle({
  value, onChange,
}: { value: PrinterType; onChange: (v: PrinterType) => void }) {
  return (
    <View style={tt.row}>
      {(['wifi', 'bluetooth'] as PrinterType[]).map((t) => (
        <TouchableOpacity
          key={t}
          style={[tt.btn, value === t && tt.btnSel]}
          onPress={() => onChange(t)}
          activeOpacity={0.7}
        >
          <Text style={[tt.text, value === t && tt.textSel]}>
            {t === 'wifi' ? '📶 WiFi' : '🔵 Bluetooth'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function WidthToggle({
  value, onChange,
}: { value: PaperWidth; onChange: (v: PaperWidth) => void }) {
  return (
    <View style={tt.row}>
      {(['58mm', '80mm'] as PaperWidth[]).map((w) => (
        <TouchableOpacity
          key={w}
          style={[tt.btn, value === w && tt.btnSel]}
          onPress={() => onChange(w)}
          activeOpacity={0.7}
        >
          <Text style={[tt.text, value === w && tt.textSel]}>
            {w === '58mm' ? '58 mm  (32 chars)' : '80 mm  (48 chars)'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:  { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  center:  { flex: 1, justifyContent: 'center', alignItems: 'center' },

  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  pageTitle: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flexWrap: 'wrap',
  },
  errorText: {
    fontSize: FontSize.sm,
    color: Colors.danger,
    maxWidth: 280,
  },
  savedText: {
    fontSize: FontSize.sm,
    color: Colors.green700,
    fontWeight: FontWeight.semibold,
  },
  saveBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    minWidth: 130,
    alignItems: 'center',
    ...Shadow.sm,
  },
  saveBtnOff: { opacity: 0.6 },
  saveBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },

  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: FontSize.base,
    color: Colors.gray800,
    backgroundColor: Colors.white,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});

const sec = StyleSheet.create({
  root:  { gap: Spacing.sm },
  title: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    ...Shadow.sm,
  },
});

const fld = StyleSheet.create({
  root:  { gap: Spacing.xs },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
  },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.gray400,
  },
});

const tt = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  btn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  btnSel: {
    borderColor: Colors.green600,
    backgroundColor: Colors.green50,
  },
  text: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.gray600,
  },
  textSel: {
    color: Colors.green700,
    fontWeight: FontWeight.bold,
  },
});
