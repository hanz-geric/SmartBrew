import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, Radius, Shadow, Spacing } from '../../constants/theme';

interface Props {
  children: React.ReactNode;
  /** Padding applied inside the card (default Spacing.lg). Pass 0 for flush content. */
  padding?: number;
  /** Elevation level; maps to the theme Shadow tokens. Default "sm". */
  elevation?: 'none' | 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}

/** Surface container with consistent radius, padding and shadow. */
export default function Card({ children, padding = Spacing.lg, elevation = 'sm', style }: Props) {
  return (
    <View
      style={[
        styles.card,
        { padding },
        elevation !== 'none' && Shadow[elevation],
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
