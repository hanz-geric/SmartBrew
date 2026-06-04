import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '../../constants/theme';

export type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

interface Props {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: Colors.green100, fg: Colors.green800 },
  danger:  { bg: Colors.dangerBg, fg: Colors.danger },
  warning: { bg: Colors.warningBg, fg: Colors.warning },
  info:    { bg: Colors.infoBg, fg: Colors.info },
  neutral: { bg: Colors.gray100, fg: Colors.gray700 },
};

/** Compact status pill with semantic tones. */
export default function Badge({ label, tone = 'neutral', style }: Props) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }, style]}>
      <Text style={[styles.text, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.xs / 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
  },
  text: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
});
