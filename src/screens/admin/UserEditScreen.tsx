import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Switch, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { AppModal } from '../../components/ui';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { listUsers, updateUserProfile } from '../../firebase/firestoreService';
import { createUserAccount, resetUserPassword } from '../../firebase/auth';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Nav   = NativeStackNavigationProp<AdminStackParamList>;
type Route = RouteProp<AdminStackParamList, 'UserEdit'>;

const ROLES: UserRole[] = ['cashier', 'manager', 'admin'];

export default function UserEditScreen() {
  const navigation  = useNavigation<Nav>();
  const route       = useRoute<Route>();
  const { userId }  = route.params;
  const isNew       = !userId;
  const currentUser = useAuthStore((s) => s.user)!;

  const [loading,          setLoading]          = useState(!isNew);
  const [saving,           setSaving]           = useState(false);
  const [error,            setError]            = useState('');
  const [showToggleConfirm, setShowToggleConfirm] = useState(false);

  const [username,    setUsername]    = useState('');
  const [fullName,    setFullName]    = useState('');
  const [password,    setPassword]    = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [role,        setRole]        = useState<UserRole>('cashier');
  const [isActive,    setIsActive]    = useState(true);

  useEffect(() => {
    if (!isNew) load();
  }, []);

  async function load() {
    try {
      const users = await listUsers();
      const u     = users.find((x) => x.uid === userId);
      if (u) {
        setUsername(u.username);
        setFullName(u.full_name);
        setRole(u.role);
        setIsActive(u.is_active);
      }
    } catch {
      setError('Failed to load user.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setError('');
    const uname = username.trim().toLowerCase();
    const fname = fullName.trim();

    if (!uname) { setError('Username is required.'); return; }
    if (!/^[a-z0-9_]+$/.test(uname)) { setError('Username: only letters, numbers, and underscores.'); return; }
    if (!fname)  { setError('Full name is required.'); return; }
    if (isNew && password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (!isNew && newPassword.length > 0 && newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    // Prevent admin from deactivating themselves
    if (!isNew && userId === currentUser.uid && !isActive) {
      setError('You cannot deactivate your own account.');
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        await createUserAccount(uname, password, fname, role);
      } else {
        await updateUserProfile(userId!, { full_name: fname, role, is_active: isActive });
        if (newPassword.length >= 6) {
          await resetUserPassword(userId!, newPassword);
        }
      }
      navigation.goBack();
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? '';
      if (code === 'auth/email-already-in-use') {
        setError(`Username "${uname}" is already taken.`);
      } else if (code === 'permission-denied') {
        setError('Permission denied.');
      } else {
        setError((e as Error).message || 'Failed to save. Check your connection.');
      }
    } finally {
      setSaving(false);
    }
  }

  function confirmDeactivate() {
    if (userId === currentUser.uid) {
      setError('You cannot deactivate your own account.');
      return;
    }
    setShowToggleConfirm(true);
  }

  if (loading) {
    return (
      <AdminLayout active="Users">
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.green600} />
        </View>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout active="Users">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'android' ? 'height' : 'padding'}
      >
        <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={s.pageHeader}>
            <View style={s.headerLeft}>
              <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
                <Text style={s.backText}>‹ Back</Text>
              </TouchableOpacity>
              <Text style={s.pageTitle}>{isNew ? 'New User' : 'Edit User'}</Text>
            </View>
            <View style={s.headerRight}>
              {!!error && (
                <View style={s.errorInline}>
                  <Text style={s.errorText}>{error}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[s.saveBtn, saving && s.saveBtnOff]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={s.saveBtnText}>{isNew ? 'Create User' : 'Save Changes'}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>

          {/* Account Info */}
          <Section title="Account Info">
            <Field label="Username" required hint={isNew ? 'Letters, numbers, underscores only. Cannot be changed after creation.' : undefined}>
              <TextInput
                style={[s.input, !isNew && s.inputDisabled]}
                value={username}
                onChangeText={setUsername}
                placeholder="e.g. cashier1"
                placeholderTextColor={Colors.gray400}
                autoCapitalize="none"
                editable={isNew}
              />
            </Field>

            <Field label="Full Name" required>
              <TextInput
                style={s.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="e.g. Juan dela Cruz"
                placeholderTextColor={Colors.gray400}
              />
            </Field>

            {isNew && (
              <Field label="Password" required hint="Minimum 6 characters">
                <TextInput
                  style={s.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={Colors.gray400}
                  secureTextEntry
                />
              </Field>
            )}

            {!isNew && (
              <Field label="New Password" hint="Leave blank to keep the current password">
                <TextInput
                  style={s.input}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="••••••••"
                  placeholderTextColor={Colors.gray400}
                  secureTextEntry
                />
              </Field>
            )}
          </Section>

          {/* Role */}
          <Section title="Role">
            <View style={s.roleRow}>
              {ROLES.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[s.roleBtn, role === r && s.roleBtnSel]}
                  onPress={() => setRole(r)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.roleBtnText, role === r && s.roleBtnTextSel]}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </Text>
                  <Text style={[s.roleDesc, role === r && s.roleDescSel]}>
                    {r === 'cashier' ? 'POS only'
                      : r === 'manager' ? 'Reports + inventory'
                      : 'Full access'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Section>

          {/* Status — edit only */}
          {!isNew && (
            <Section title="Status">
              <View style={s.statusRow}>
                <View style={s.statusInfo}>
                  <Text style={s.statusLabel}>
                    {isActive ? 'Active' : 'Inactive'}
                  </Text>
                  <Text style={s.statusHint}>
                    {isActive
                      ? 'User can log in and use the app'
                      : 'User is blocked from logging in'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[s.toggleBtn, isActive ? s.toggleBtnDeactivate : s.toggleBtnActivate]}
                  onPress={confirmDeactivate}
                  activeOpacity={0.8}
                  disabled={userId === currentUser.uid}
                >
                  <Text style={[s.toggleBtnText, isActive ? s.toggleTextDeactivate : s.toggleTextActivate]}>
                    {isActive ? 'Deactivate' : 'Activate'}
                  </Text>
                </TouchableOpacity>
              </View>
              {userId === currentUser.uid && (
                <Text style={s.selfNote}>You cannot change your own active status.</Text>
              )}
            </Section>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <AppModal
        visible={showToggleConfirm}
        variant="confirm"
        danger={isActive}
        title={isActive ? 'Deactivate User' : 'Activate User'}
        body={isActive
          ? `"${fullName}" will no longer be able to log in.`
          : `"${fullName}" will be able to log in again.`}
        confirmText={isActive ? 'Deactivate' : 'Activate'}
        onCancel={() => setShowToggleConfirm(false)}
        onConfirm={() => { setShowToggleConfirm(false); setIsActive((v) => !v); }}
      />
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
  label, hint, required, children,
}: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={fld.root}>
      <View style={fld.labelRow}>
        <Text style={fld.label}>{label}</Text>
        {required && <Text style={fld.required}>*</Text>}
      </View>
      {!!hint && <Text style={fld.hint}>{hint}</Text>}
      {children}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: Colors.background },
  content:  { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  center:   { flex: 1, justifyContent: 'center', alignItems: 'center' },

  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  headerLeft:  { gap: Spacing.xs },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexWrap: 'wrap' },
  backText:    { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.medium },
  pageTitle:   { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: Colors.gray900 },
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
  errorText:   { fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.medium },

  saveBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    minWidth: 130,
    alignItems: 'center',
    ...Shadow.sm,
  },
  saveBtnOff:  { opacity: 0.6 },
  saveBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },

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
  inputDisabled: {
    backgroundColor: Colors.gray100,
    color: Colors.gray500,
  },

  infoBox: {
    backgroundColor: Colors.infoBg,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.info + '44',
  },
  infoText: { fontSize: FontSize.sm, color: Colors.info, lineHeight: 18 },

  roleRow: { flexDirection: 'row', gap: Spacing.sm },
  roleBtn: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    gap: 4,
  },
  roleBtnSel:      { borderColor: Colors.green600, backgroundColor: Colors.green50 },
  roleBtnText:     { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.gray600, textTransform: 'capitalize' },
  roleBtnTextSel:  { color: Colors.green700 },
  roleDesc:        { fontSize: FontSize.xs, color: Colors.gray400, textAlign: 'center' },
  roleDescSel:     { color: Colors.green600 },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  statusInfo:  { flex: 1, gap: 2 },
  statusLabel: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray900 },
  statusHint:  { fontSize: FontSize.xs, color: Colors.gray400 },

  toggleBtn:            { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.md, borderWidth: 1.5 },
  toggleBtnDeactivate:  { borderColor: Colors.danger,   backgroundColor: Colors.dangerBg },
  toggleBtnActivate:    { borderColor: Colors.green600, backgroundColor: Colors.green50 },
  toggleBtnText:        { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  toggleTextDeactivate: { color: Colors.danger },
  toggleTextActivate:   { color: Colors.green700 },

  selfNote: { fontSize: FontSize.xs, color: Colors.gray400, marginTop: -Spacing.sm },
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
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    gap: Spacing.lg,
    ...Shadow.sm,
  },
});

const fld = StyleSheet.create({
  root:     { gap: Spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label:    { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  required: { fontSize: FontSize.sm, color: Colors.danger },
  hint:     { fontSize: FontSize.xs, color: Colors.gray400 },
});
