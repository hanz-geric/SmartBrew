import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, FontSize, Spacing } from '../../constants/theme';

interface Props {
  /** Optional label shown under the spinner. */
  label?: string;
  /** Spinner size. Default "large". */
  size?: 'small' | 'large';
  /** Spinner colour. Default brand green. */
  color?: string;
  /** Fill the parent and center (default true). Pass false for inline use. */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Centered loading spinner with an optional label. */
export default function LoadingState({
  label,
  size = 'large',
  color = Colors.green600,
  fill = true,
  style,
}: Props) {
  return (
    <View style={[fill && styles.fill, styles.center, style]}>
      <ActivityIndicator size={size} color={color} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center', padding: Spacing.lg },
  label: {
    marginTop: Spacing.md,
    fontSize: FontSize.base,
    color: Colors.gray500,
  },
});
