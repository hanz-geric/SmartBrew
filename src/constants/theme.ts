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
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  28,
  xxxl: 40,
} as const;

export const Radius = {
  sm:  6,
  md:  8,
  lg:  10,
  xl:  14,
  full: 999,
} as const;

export const FontSize = {
  xs:   10,
  sm:   12,
  base: 14,
  md:   15,
  lg:   16,
  xl:   18,
  xxl:  20,
  xxxl: 24,
  display: 28,
} as const;

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
