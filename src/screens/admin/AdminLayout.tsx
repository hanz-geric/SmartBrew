import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { useAuthStore } from '../../store/authStore';
import { logout } from '../../firebase/auth';
import {
  Colors, FontSize, FontWeight, Radius, Spacing,
} from '../../constants/theme';

type AdminNav  = NativeStackNavigationProp<AdminStackParamList>;
type Screen    = keyof AdminStackParamList;
type NavScreen = 'Dashboard' | 'Orders' | 'Sessions' | 'Products' | 'Modifiers' | 'Stock' | 'Users' | 'Settings';

interface Props {
  active:   Screen;
  children: React.ReactNode;
}

const NAV_ITEMS: { screen: NavScreen; label: string; icon: string; adminOnly?: boolean }[] = [
  { screen: 'Dashboard', label: 'Dashboard', icon: '📊' },
  { screen: 'Orders',    label: 'Orders',    icon: '🧾' },
  { screen: 'Sessions',  label: 'Sessions',  icon: '💰' },
  { screen: 'Products',  label: 'Menu',      icon: '🍽️', adminOnly: true },
  { screen: 'Modifiers', label: 'Modifiers', icon: '🎛️', adminOnly: true },
  { screen: 'Stock',     label: 'Stock',     icon: '📦' },
  { screen: 'Users',     label: 'Users',     icon: '👥', adminOnly: true },
  { screen: 'Settings',  label: 'Settings',  icon: '⚙️', adminOnly: true },
];

export default function AdminLayout({ active, children }: Props) {
  const navigation = useNavigation<AdminNav>();
  const user       = useAuthStore((s) => s.user)!;

  async function handleLogout() {
    await logout();
  }

  return (
    <View style={s.root}>
      {/* ── Sidebar ── */}
      <View style={s.sidebar}>
        <View style={s.brand}>
          <Text style={s.brandIcon}>☕</Text>
          <Text style={s.brandName}>SmartBrew</Text>
          <Text style={s.brandRole}>
            {user.role === 'admin' ? 'Admin' : 'Manager'}
          </Text>
        </View>

        <View style={s.navItems}>
          {NAV_ITEMS.filter((item) => !item.adminOnly || user.role === 'admin').map(({ screen, label, icon }) => {
            const isActive = active === screen;
            return (
              <TouchableOpacity
                key={screen}
                style={[s.navItem, isActive && s.navItemActive]}
                onPress={() => navigation.navigate(screen)}
                activeOpacity={0.7}
              >
                <Text style={s.navIcon}>{icon}</Text>
                <Text style={[s.navLabel, isActive && s.navLabelActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.sidebarFooter}>
          <Text style={s.userName} numberOfLines={1}>{user.full_name}</Text>
          <Text style={s.userHandle} numberOfLines={1}>@{user.username}</Text>
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Text style={s.logoutText}>Log out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Main content ── */}
      <View style={s.content}>
        {children}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: Colors.background,
  },

  // Sidebar
  sidebar: {
    width: 200,
    backgroundColor: Colors.green800,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xl,
    flexDirection: 'column',
  },
  brand: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: Spacing.md,
  },
  brandIcon: {
    fontSize: 28,
  },
  brandName: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.white,
    marginTop: Spacing.xs,
  },
  brandRole: {
    fontSize: FontSize.xs,
    color: Colors.green200,
    fontWeight: FontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  navItems: {
    flex: 1,
    paddingTop: Spacing.sm,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  navItemActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  navIcon: {
    fontSize: 16,
  },
  navLabel: {
    fontSize: FontSize.base,
    color: Colors.green200,
    fontWeight: FontWeight.medium,
  },
  navLabelActive: {
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },

  sidebarFooter: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: Spacing.xs,
  },
  userName: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.white,
  },
  userHandle: {
    fontSize: FontSize.xs,
    color: Colors.green200,
  },
  logoutBtn: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  logoutText: {
    fontSize: FontSize.sm,
    color: Colors.white,
    fontWeight: FontWeight.medium,
  },

  // Content
  content: {
    flex: 1,
    overflow: 'hidden',
  },
});
