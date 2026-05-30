import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { getAllModifierGroups } from '../../firebase/firestoreService';
import { ModifierGroup } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

export default function ModifiersScreen() {
  const navigation = useNavigation<Nav>();
  const [groups,  setGroups]  = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useFocusEffect(
    useCallback(() => {
      load();
    }, []),
  );

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await getAllModifierGroups();
      setGroups(data);
    } catch {
      setError('Failed to load modifier groups.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AdminLayout active="Modifiers">
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>Modifier Groups</Text>
          <TouchableOpacity
            style={s.addBtn}
            onPress={() => navigation.navigate('ModifierGroupEdit', {})}
            activeOpacity={0.8}
          >
            <Text style={s.addBtnText}>+ Add Group</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.subtitle}>
          Modifier groups are assigned to products. Each group contains the options a customer can choose from (e.g. Size: Small, Medium, Large).
        </Text>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.green600} />
          </View>
        ) : error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : groups.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>No modifier groups yet. Tap "+ Add Group" to create one.</Text>
          </View>
        ) : (
          <FlatList
            data={groups}
            keyExtractor={(g) => g.id}
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            renderItem={({ item: g }) => (
              <GroupCard
                group={g}
                onPress={() => navigation.navigate('ModifierGroupEdit', { groupId: g.id })}
              />
            )}
          />
        )}
      </View>
    </AdminLayout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GroupCard({ group, onPress }: { group: ModifierGroup; onPress: () => void }) {
  const active   = group.modifiers.filter((m) => m.is_active !== false);
  const inactive = group.modifiers.filter((m) => m.is_active === false);

  return (
    <TouchableOpacity style={gc.card} onPress={onPress} activeOpacity={0.7}>
      <View style={gc.header}>
        <View style={gc.titleRow}>
          <Text style={gc.name}>{group.name}</Text>
          {group.is_active === false && (
            <View style={[gc.badge, { backgroundColor: Colors.gray200, borderColor: Colors.gray400 }]}>
              <Text style={[gc.badgeText, { color: Colors.gray500 }]}>Inactive</Text>
            </View>
          )}
          {group.is_required && (
            <View style={[gc.badge, { backgroundColor: Colors.green50, borderColor: Colors.green600 }]}>
              <Text style={[gc.badgeText, { color: Colors.green700 }]}>Required</Text>
            </View>
          )}
        </View>
        <View style={gc.meta}>
          <Text style={gc.metaText}>
            Max select: {group.max_select} · {group.modifiers.length} option{group.modifiers.length !== 1 ? 's' : ''}
            {inactive.length > 0 ? ` (${inactive.length} inactive)` : ''}
          </Text>
        </View>
      </View>

      <View style={gc.divider} />

      <View style={gc.modifiers}>
        {active.map((m) => (
          <View key={m.id} style={gc.modRow}>
            <Text style={gc.modName}>{m.name}</Text>
            <Text style={gc.modPrice}>
              {m.price_delta === 0 ? 'free' : `+₱${m.price_delta.toFixed(2)}`}
            </Text>
          </View>
        ))}
        {group.modifiers.length === 0 && (
          <Text style={gc.noMods}>No modifiers — tap to add some.</Text>
        )}
      </View>

      <Text style={gc.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xs,
  },
  title: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
    lineHeight: 18,
  },
  addBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    ...Shadow.sm,
  },
  addBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  scroll:        { flex: 1 },
  scrollContent: { padding: Spacing.xl, gap: Spacing.md, paddingTop: 0 },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:         { paddingTop: Spacing.xxxl, alignItems: 'center', paddingHorizontal: Spacing.xl },
  emptyText:     { fontSize: FontSize.base, color: Colors.gray400, textAlign: 'center' },
  errorBox: {
    margin: Spacing.xl,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    padding: Spacing.lg,
  },
  errorText: { color: Colors.danger, fontSize: FontSize.base },
});

const gc = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  header:   { gap: Spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  name:     { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.gray900 },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  badgeText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  meta:     {},
  metaText: { fontSize: FontSize.xs, color: Colors.gray400 },
  divider:  { height: 1, backgroundColor: Colors.border },
  modifiers: { gap: 4 },
  modRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modName:  { fontSize: FontSize.sm, color: Colors.gray700, fontWeight: FontWeight.medium },
  modPrice: { fontSize: FontSize.sm, color: Colors.gray400 },
  noMods:   { fontSize: FontSize.sm, color: Colors.gray400, fontStyle: 'italic' },
  chevron: {
    position: 'absolute',
    right: Spacing.lg,
    top: Spacing.lg,
    fontSize: 20,
    color: Colors.gray400,
  },
});
