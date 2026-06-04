import { Dimensions } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export const BREAKPOINTS = {
  tablet:      768,
  tabletLarge: 1024,
} as const;

/**
 * True when the app is running on a tablet-sized screen.
 * Uses the SHORT side so portrait 8.7" tablets (logical ~533px wide) are
 * correctly detected — their short side is still >= 500px.
 */
export const isTablet = Math.min(SCREEN_W, SCREEN_H) >= 500;

/**
 * Responsive scale — returns `value * factor` on tablet, plain `value` on phone.
 * Default factor 1.2 gives a gentle bump without over-scaling.
 */
export function rs(value: number, factor = 1.2): number {
  return isTablet ? Math.round(value * factor) : value;
}

export const Colors = {
  // Green palette (matches PHP app)
  green50:  '#f0fdf4',
  green100: '#dcfce7',
  green200: '#bbf7d0',
  green400: '#4ade80',
  green500: '#22c55e',
  green600: '#16a34a',
  green700: '#15803d',
  green800: '#166534',

  // Grays
  gray50:  '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray600: '#4b5563',
  gray700: '#374151',
  gray800: '#1f2937',
  gray900: '#111827',

  // Semantic
  white:   '#ffffff',
  danger:  '#dc2626',
  dangerBg:'#fef2f2',
  warning: '#854d0e',
  warningBg:'#fef9c3',
  info:    '#2563eb',
  infoBg:  '#eff6ff',

  // UI surfaces
  background: '#f9fafb',
  surface:    '#ffffff',
  border:     '#e5e7eb',
} as const;

export const Spacing = {
  xs:   rs(4),
  sm:   rs(8),
  md:   rs(12),
  lg:   rs(16),
  xl:   rs(20),
  xxl:  rs(28),
  xxxl: rs(40),
};

export const Radius = {
  sm:   rs(6),
  md:   rs(8),
  lg:   rs(10),
  xl:   rs(14),
  full: 999,
};

export const FontSize = {
  xs:      rs(10),
  sm:      rs(12),
  base:    rs(14),
  md:      rs(15),
  lg:      rs(16),
  xl:      rs(18),
  xxl:     rs(20),
  xxxl:    rs(24),
  display: rs(28),
};

export const FontWeight = {
  normal:    '400' as const,
  medium:    '500' as const,
  semibold:  '600' as const,
  bold:      '700' as const,
  extrabold: '800' as const,
};

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;
