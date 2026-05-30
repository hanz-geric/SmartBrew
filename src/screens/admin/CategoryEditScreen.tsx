import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Switch, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { getAllCategories, upsertCategory } from '../../firebase/firestoreService';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Nav   = NativeStackNavigationProp<AdminStackParamList>;
type Route = RouteProp<AdminStackParamList, 'CategoryEdit'>;

export default function CategoryEditScreen() {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const { categoryId } = route.params;
  const isNew = !categoryId;

  const [loading,  setLoading]  = useState(!isNew);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const [name,      setName]      = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [isActive,  setIsActive]  = useState(true);

  useEffect(() => {
    if (!isNew) load();
  }, []);

  async function load() {
    try {
      const cats = await getAllCategories();
      const cat  = cats.find((c) => c.id === categoryId);
      if (!cat) { setError('Category not found.'); return; }
      setName(cat.name);
      setSortOrder(String(cat.sort_order));
      setIsActive(cat.is_active);
    } catch {
      setError('Failed to load category.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setError('');
    const trimmed  = name.trim();
    const sortNum  = parseInt(sortOrder, 10);
    if (!trimmed)  { setError('Name is required.'); return; }
    if (isNaN(sortNum) || sortNum < 0) { setError('Sort order must be 0 or higher.'); return; }

    setSaving(true);
    try {
      await upsertCategory(
        {
          name:       trimmed,
          sort_order: sortNum,
          is_active:  isActive,
        },
        categoryId,
      );
      navigation.goBack();
    } catch (e: unknown) {
      const msg = (e as { code?: string }).code === 'permission-denied'
        ? 'Permission denied.'
        : 'Failed to save. Check your connection.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AdminLayout active="Products">
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.green600} />
        </View>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout active="Products">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={s.pageHeader}>
            <View style={s.headerLeft}>
              <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
                <Text style={s.backText}>‹ Back</Text>
              </TouchableOpacity>
              <Text style={s.pageTitle}>{isNew ? 'New Category' : 'Edit Category'}</Text>
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
                  : <Text style={s.saveBtnText}>{isNew ? 'Create' : 'Save Changes'}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>

          {/* Form */}
          <View style={s.card}>
            <Field label="Category Name" required>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Hot Drinks"
                placeholderTextColor={Colors.gray400}
              />
            </Field>

            <Field label="Sort Order" hint="Lower numbers appear first in the POS">
              <TextInput
                style={s.input}
                value={sortOrder}
                onChangeText={setSortOrder}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={Colors.gray400}
              />
            </Field>

            <View style={s.switchRow}>
              <View style={s.switchLabel}>
                <Text style={s.fieldLabel}>Active</Text>
                <Text style={s.fieldHint}>Inactive categories are hidden from the POS</Text>
              </View>
              <Switch
                value={isActive}
                onValueChange={setIsActive}
                trackColor={{ true: Colors.green600, false: Colors.gray300 }}
                thumbColor={Colors.white}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AdminLayout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

  backBtn:  {},
  backText: { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.medium },
  pageTitle: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
  },

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
  errorText: { fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.medium },

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

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    gap: Spacing.lg,
    ...Shadow.sm,
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

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: { flex: 1, gap: 2 },
  fieldLabel:  { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  fieldHint:   { fontSize: FontSize.xs, color: Colors.gray400 },
});

const fld = StyleSheet.create({
  root:     { gap: Spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label:    { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  required: { fontSize: FontSize.sm, color: Colors.danger },
  hint:     { fontSize: FontSize.xs, color: Colors.gray400 },
});
