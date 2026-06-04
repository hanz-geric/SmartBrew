import { forwardRef } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '../../constants/theme';

interface Props extends TextInputProps {
  label?: string;
  /** Inline validation error; turns the border red and shows the message below. */
  error?: string;
  /** Hint shown under the field when there is no error. */
  hint?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

/** Labeled text field with inline error/hint support. */
const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, hint, containerStyle, style, ...rest },
  ref,
) {
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={Colors.gray400}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

export default Input;

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.md },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.gray700,
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.base,
    color: Colors.gray900,
  },
  inputError: { borderColor: Colors.danger },
  error: {
    marginTop: Spacing.xs,
    fontSize: FontSize.sm,
    color: Colors.danger,
  },
  hint: {
    marginTop: Spacing.xs,
    fontSize: FontSize.sm,
    color: Colors.gray500,
  },
});
