import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '../../constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Props {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Optional leading glyph/emoji rendered before the title. */
  icon?: string;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const VARIANTS: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary:   { bg: Colors.green600, fg: Colors.white },
  secondary: { bg: Colors.gray100,  fg: Colors.gray800, border: Colors.border },
  danger:    { bg: Colors.danger,   fg: Colors.white },
  ghost:     { bg: 'transparent',   fg: Colors.green700 },
};

const SIZES: Record<ButtonSize, { padV: number; padH: number; font: number }> = {
  sm: { padV: Spacing.xs, padH: Spacing.md, font: FontSize.sm },
  md: { padV: Spacing.md, padH: Spacing.xl, font: FontSize.base },
  lg: { padV: Spacing.lg, padH: Spacing.xxl, font: FontSize.lg },
};

/**
 * Themed button covering the four variants used across the app. Replaces hand-rolled
 * TouchableOpacity + Text + style triplets. Shows an inline spinner and blocks presses
 * while `loading`.
 */
export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
  style,
  textStyle,
}: Props) {
  const v = VARIANTS[variant];
  const s = SIZES[size];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        styles.base,
        {
          backgroundColor: v.bg,
          paddingVertical: s.padV,
          paddingHorizontal: s.padH,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
        },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Text style={[styles.icon, { color: v.fg, fontSize: s.font }]}>{icon}</Text> : null}
          <Text style={[styles.text, { color: v.fg, fontSize: s.font }, textStyle]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.5 },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { fontWeight: FontWeight.semibold },
  text: { fontWeight: FontWeight.semibold },
});
