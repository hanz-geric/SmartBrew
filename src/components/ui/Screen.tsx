import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { Colors } from '../../constants/theme';

interface Props {
  children: React.ReactNode;
  /** Wrap content in a ScrollView. Default false. */
  scroll?: boolean;
  /** Safe-area edges to inset. Default ['top','bottom']. */
  edges?: Edge[];
  /** Override the background colour (default Colors.background). */
  background?: string;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/** Root wrapper that applies safe-area insets and the app background. */
export default function Screen({
  children,
  scroll = false,
  edges = ['top', 'bottom'],
  background = Colors.background,
  style,
  contentContainerStyle,
}: Props) {
  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: background }, style]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={contentContainerStyle}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, contentContainerStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
});
