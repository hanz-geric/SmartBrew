import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { listUsers } from '../../firebase/firestoreService';
import { useAuthStore } from '../../store/authStore';
import { UserProfile } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

const ROLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  admin:   { bg: '#fef2f2', border: Colors.danger,  text: Colors.danger  },
  manager: { bg: Colors.infoBg,  border: Colors.info,    text: Colors.info    },
  cashier: { bg: Colors.green50, border: Colors.green600, text: Colors.green700 },
};

export default function UsersScreen() {
  const navigation = useNavigation<Nav>();
  const currentUser = useAuthStore((s) => s.user)!;
  const isAdmin     = currentUser.role === 'admin';

  const [users,   setUsers]   = useState<UserProfile[]>([]);
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
      setUsers(await listUsers());
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? '';
      setError(
        code === 'permission-denied'
          ? 'Permission denied — update Firestore rules to allow listing the users collection. See console for details.'
          : `Failed to load users: ${(e as Error).message}`,
      );
    } finally {
      setLoading(false);
    }
  }

  const active   = users.filter((u) => u.is_active);
  const inactive = users.filter((u) => !u.is_active);

  return (
    <AdminLayout active="Users">
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>Users</Text>
            <Text style={s.subtitle}>{users.length} total · {active.length} active</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity
              style={s.addBtn}
              onPress={() => navigation.navigate('UserEdit', {})}
              activeOpacity={0.8}
            >
              <Text style={s.addBtnText}>+ Add User</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.green600} />
          </View>
        ) : error ? (
          <View style={s.errorBox}>
            <Text style={s.errorTitle}>Could not load users</Text>
            <Text style={s.errorMsg}>{error}</Text>
          </View>
        ) : (
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
            {active.length > 0 && (
              <UserGroup title="Active" users={active} currentUid={currentUser.uid} isAdmin={isAdmin}
                onPress={(u) => isAdmin && navigation.navigate('UserEdit', { userId: u.uid })}
              />
            )}
            {inactive.length > 0 && (
              <UserGroup title="Inactive" users={inactive} currentUid={currentUser.uid} isAdmin={isAdmin}
                onPress={(u) => isAdmin && navigation.navigate('UserEdit', { userId: u.uid })}
              />
            )}
            {users.length === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyText}>No users found.</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </AdminLayout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function UserGroup({
  title, users, currentUid, isAdmin, onPress,
}: {
  title:      string;
  users:      UserProfile[];
  currentUid: string;
  isAdmin:    boolean;
  onPress:    (u: UserProfile) => void;
}) {
  return (
    <View style={ug.root}>
      <Text style={ug.title}>{title}</Text>
      <View style={ug.card}>
        {users.map((u, i) => (
          <React.Fragment key={u.uid}>
            {i > 0 && <View style={ug.divider} />}
            <UserRow
              user={u}
              isSelf={u.uid === currentUid}
              isAdmin={isAdmin}
              onPress={() => onPress(u)}
            />
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

function UserRow({
  user, isSelf, isAdmin, onPress,
}: {
  user:    UserProfile;
  isSelf:  boolean;
  isAdmin: boolean;
  onPress: () => void;
}) {
  const roleStyle = ROLE_COLORS[user.role] ?? ROLE_COLORS.cashier;

  return (
    <TouchableOpacity
      style={ur.row}
      onPress={onPress}
      activeOpacity={isAdmin ? 0.7 : 1}
      disabled={!isAdmin}
    >
      <View style={ur.avatar}>
        <Text style={ur.avatarText}>{user.full_name.charAt(0).toUpperCase() || '?'}</Text>
      </View>
      <View style={ur.info}>
        <View style={ur.nameRow}>
          <Text style={ur.name}>{user.full_name}</Text>
          {isSelf && (
            <View style={[ur.badge, { backgroundColor: Colors.green50, borderColor: Colors.green600 }]}>
              <Text style={[ur.badgeText, { color: Colors.green700 }]}>You</Text>
            </View>
          )}
        </View>
        <Text style={ur.username}>@{user.username}</Text>
      </View>
      <View style={[ur.roleBadge, { backgroundColor: roleStyle.bg, borderColor: roleStyle.border }]}>
        <Text style={[ur.roleText, { color: roleStyle.text }]}>{user.role}</Text>
      </View>
      {isAdmin && <Text style={ur.chevron}>›</Text>}
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  header:  {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title:    { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: Colors.gray900 },
  subtitle: { fontSize: FontSize.sm, color: Colors.gray400, marginTop: 2 },
  addBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    ...Shadow.sm,
  },
  addBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },
  scroll:        { flex: 1 },
  scrollContent: { padding: Spacing.xl, gap: Spacing.xl, paddingTop: 0 },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:         { paddingTop: Spacing.xxxl, alignItems: 'center' },
  emptyText:     { fontSize: FontSize.base, color: Colors.gray400 },
  errorBox: {
    margin: Spacing.xl,
    padding: Spacing.xl,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    gap: Spacing.sm,
  },
  errorTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.danger },
  errorMsg:   { fontSize: FontSize.sm, color: Colors.danger, lineHeight: 18 },
});

const ug = StyleSheet.create({
  root:    { gap: Spacing.sm },
  title: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: 60 },
});

const ur = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.green100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.green700 },
  info:       { flex: 1, gap: 2 },
  nameRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name:       { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray900 },
  username:   { fontSize: FontSize.sm, color: Colors.gray400 },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontWeight: FontWeight.bold },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  roleText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold, textTransform: 'capitalize' },
  chevron: { fontSize: 20, color: Colors.gray400 },
});
