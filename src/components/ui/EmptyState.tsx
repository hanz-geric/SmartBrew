import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, FontSize, FontWeight, Spacing } from '../../constants/theme';
import Button from './Button';

interface Props {
  /** Leading glyph/emoji (e.g. "☕", "📋"). */
  icon?: string;
  title: string;
  message?: string;
  /** Optional call-to-action rendered as a button. */
  action?: { label: string; onPress: () => void };
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Consistent empty-list placeholder: icon + title + optional message and action. */
export default function EmptyState({ icon, title, message, action, fill = true, style }: Props) {
  return (
    <View style={[fill && styles.fill, styles.center, style]}>
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? (
        <View style={styles.action}>
          <Button title={action.label} onPress={action.onPress} variant="secondary" size="sm" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center', padding: Spacing.xxl },
  icon: { fontSize: FontSize.display, marginBottom: Spacing.md },
  title: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
    textAlign: 'center',
  },
  message: {
    marginTop: Spacing.xs,
    fontSize: FontSize.base,
    color: Colors.gray500,
    textAlign: 'center',
    lineHeight: FontSize.base * 1.5,
  },
  action: { marginTop: Spacing.lg },
});
