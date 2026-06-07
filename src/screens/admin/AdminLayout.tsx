import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Image, ScrollView, StyleSheet, Text,
  TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { useAuthStore } from '../../store/authStore';
import { logout } from '../../firebase/auth';
import { useIdleTimeout } from '../../hooks/useIdleTimeout';
import { ADMIN_IDLE_TIMEOUT_MS } from '../../constants/config';
import {
  Colors, FontSize, FontWeight, Radius, Spacing, isTablet, rs,
} from '../../constants/theme';

type AdminNav  = NativeStackNavigationProp<AdminStackParamList>;
type Screen    = keyof AdminStackParamList;
type NavScreen = 'Dashboard' | 'Orders' | 'Sessions' | 'Products' | 'Modifiers' | 'Stock' | 'Users' | 'Settings';

interface Props {
  active:   Screen;
  children: React.ReactNode;
}

const NAV_ITEMS: { screen: NavScreen; label: string; icon: string; adminOnly?: boolean; managerOnly?: boolean }[] = [
  { screen: 'Dashboard', label: 'Dashboard',  icon: '📊' },
  { screen: 'Orders',    label: 'Orders',     icon: '🧾' },
  { screen: 'Sessions',  label: 'Sessions',   icon: '💰' },
  { screen: 'Products',  label: 'Menu',       icon: '🍽️', adminOnly: true },
  { screen: 'Products',  label: 'Categories', icon: '🏷️', managerOnly: true },
  { screen: 'Modifiers', label: 'Modifiers',  icon: '🎛️', adminOnly: true },
  { screen: 'Stock',     label: 'Stock',      icon: '📦' },
  { screen: 'Users',     label: 'Users',      icon: '👥', adminOnly: true },
  { screen: 'Settings',  label: 'Settings',   icon: '⚙️', adminOnly: true },
];

const SIDEBAR_W = 220;

export default function AdminLayout({ active, children }: Props) {
  const navigation = useNavigation<AdminNav>();
  const user       = useAuthStore((s) => s.user)!;
  const { width }  = useWindowDimensions();

  const isPhone = width < 768;
  // compact (icon-only) applies to medium tablets only — not phones (phones use overlay)
  const compact = !isPhone && width < 960;

  const [sidebarOpen, setSidebarOpen] = useState(!isPhone);
  const translateX = useRef(new Animated.Value(isPhone ? -SIDEBAR_W : 0)).current;

  // When device rotates from phone to tablet, always show sidebar
  useEffect(() => {
    if (!isPhone) {
      translateX.setValue(0);
      setSidebarOpen(true);
    }
  }, [isPhone, translateX]);

  const openSidebar = () => {
    setSidebarOpen(true);
    Animated.timing(translateX, {
      toValue: 0, duration: 200, useNativeDriver: true,
    }).start();
  };

  const closeSidebar = () => {
    Animated.timing(translateX, {
      toValue: -SIDEBAR_W, duration: 200, useNativeDriver: true,
    }).start(() => setSidebarOpen(false));
  };

  const handleLogout = useCallback(() => { logout(); }, []);
  const resetIdleTimer = useIdleTimeout(ADMIN_IDLE_TIMEOUT_MS, handleLogout);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly   && user.role !== 'admin')   return false;
    if (item.managerOnly && user.role !== 'manager') return false;
    return true;
  });

  return (
    <View
      style={s.root}
      onStartShouldSetResponderCapture={() => { resetIdleTimer(); return false; }}
    >

      {/* ── Scrim (phone only, dismisses sidebar on tap) ── */}
      {isPhone && sidebarOpen && (
        <TouchableOpacity
          style={s.scrim}
          activeOpacity={1}
          onPress={closeSidebar}
        />
      )}

      {/* ── Sidebar ── */}
      <Animated.View
        style={[
          s.sidebar,
          compact && s.sidebarCompact,
          isPhone  && s.sidebarPhone,
          isPhone  && { transform: [{ translateX }] },
        ]}
      >
        {/* Brand area */}
        <View style={[s.brand, compact && s.brandCompact, isPhone && s.brandPhone]}>
          <View style={{ flex: 1 }}>
            <Image
              source={require('../../../assets/images/SmartBrew_logo.jpg')}
              style={compact ? s.brandLogoCompact : s.brandLogo}
              resizeMode="cover"
            />
            {!compact && <Text style={s.brandName}>SmartBrew</Text>}
            {!compact && (
              <Text style={s.brandRole}>
                {user.role === 'admin' ? 'Admin' : 'Manager'}
              </Text>
            )}
          </View>
          {isPhone && (
            <TouchableOpacity style={s.collapseBtn} onPress={closeSidebar} activeOpacity={0.7}>
              <Text style={s.collapseBtnText}>‹‹</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView style={s.navItems} showsVerticalScrollIndicator={false}>
          {visibleItems.map(({ screen, label, icon }) => {
            const isActive = active === screen;
            return (
              <TouchableOpacity
                key={`${screen}-${label}`}
                style={[s.navItem, isActive && s.navItemActive, compact && s.navItemCompact]}
                onPress={() => {
                  navigation.navigate(screen);
                  if (isPhone) closeSidebar();
                }}
                activeOpacity={0.7}
              >
                <Text style={s.navIcon}>{icon}</Text>
                {!compact && (
                  <Text style={[s.navLabel, isActive && s.navLabelActive]} numberOfLines={1}>
                    {label}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={[s.sidebarFooter, compact && s.sidebarFooterCompact]}>
          {!compact && <Text style={s.userName} numberOfLines={1}>{user.full_name}</Text>}
          {!compact && <Text style={s.userHandle} numberOfLines={1}>@{user.username}</Text>}
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Text style={s.logoutText}>{compact ? '⏻' : 'Log out'}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ── Main content ── */}
      <View style={[s.content, isPhone && s.contentPhone]}>
        {/* Reopen tab (phone only, when sidebar is hidden) */}
        {isPhone && !sidebarOpen && (
          <TouchableOpacity style={s.openBtn} onPress={openSidebar} activeOpacity={0.8}>
            <Text style={s.openBtnText}>›</Text>
          </TouchableOpacity>
        )}
        <View style={s.contentInner}>
          {children}
        </View>
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

  // ── Sidebar ──────────────────────────────────────────────────────────────
  sidebar: {
    width: '20%',
    minWidth: 160,
    maxWidth: 240,
    backgroundColor: Colors.green800,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xl,
    flexDirection: 'column',
  },
  sidebarCompact: {
    width: 56,
    minWidth: 56,
    maxWidth: 56,
  },
  // Phone: absolutely positioned overlay, slides over content
  sidebarPhone: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: SIDEBAR_W,
    minWidth: SIDEBAR_W,
    maxWidth: SIDEBAR_W,
    zIndex: 50,
    backgroundColor: Colors.green800,
  },

  // ── Brand ─────────────────────────────────────────────────────────────────
  brand: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: Spacing.md,
  },
  brandCompact: {
    paddingHorizontal: Spacing.xs,
    paddingBottom: Spacing.lg,
    alignItems: 'center',
  },
  brandPhone: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  brandLogo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.45)',
    marginBottom: Spacing.sm,
  },
  brandLogoCompact: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
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
  collapseBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    marginTop: Spacing.xs,
  },
  collapseBtnText: {
    color: Colors.green200,
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
  },

  // ── Nav items ─────────────────────────────────────────────────────────────
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
  navItemCompact: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    marginHorizontal: Spacing.xs,
  },
  navItemActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  navIcon: {
    fontSize: rs(16),
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

  // ── Footer ────────────────────────────────────────────────────────────────
  sidebarFooter: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: Spacing.xs,
  },
  sidebarFooterCompact: {
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
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

  // ── Scrim ─────────────────────────────────────────────────────────────────
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 40,
  },

  // ── Open tab (phone, sidebar hidden) ─────────────────────────────────────
  openBtn: {
    position: 'absolute',
    left: 0,
    top: 16,
    zIndex: 10,
    width: 28,
    height: 36,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: Colors.green800,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: FontWeight.bold,
  },

  // ── Content ───────────────────────────────────────────────────────────────
  content: {
    flex: 1,
    overflow: 'hidden',
  },
  contentPhone: {
    // Stays full-width; sidebar overlays from the left
    position: 'relative',
  },
  contentInner: {
    flex: 1,
    width: '100%',
    maxWidth: isTablet ? 1280 : undefined,
    alignSelf: 'center',
  },
});
