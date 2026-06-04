import { Component, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, FontSize, FontWeight, Shadow } from '../constants/theme';
import { logError } from '../utils/logger';

interface Props {
  children: ReactNode;
  /** Tag used when persisting the error via logError (defaults to "ErrorBoundary"). */
  tag?: string;
  /** Optional custom fallback; receives a reset() to clear the error and re-render children. */
  fallback?: (reset: () => void, error: Error | null) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render-time crashes so a single bad screen can't white-screen a cashier
 * mid-transaction. Errors are persisted via logError; the user gets a recoverable
 * "Reload" fallback that clears the error state without restarting the app.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    logError(this.props.tag ?? 'ErrorBoundary', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback(this.reset, this.state.error);

    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.emoji}>!</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            The app hit an unexpected error. Your data is safe. Tap reload to continue.
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.reset} activeOpacity={0.85}>
            <Text style={styles.buttonText}>Reload</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.green700,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xxl,
    alignItems: 'center',
    maxWidth: 420,
    width: '100%',
    ...Shadow.lg,
  },
  emoji: {
    fontSize: 48,
    fontWeight: FontWeight.bold,
    color: Colors.danger,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  message: {
    fontSize: FontSize.base,
    color: Colors.gray600,
    textAlign: 'center',
    lineHeight: FontSize.base * 1.5,
    marginBottom: Spacing.xl,
  },
  button: {
    backgroundColor: Colors.green600,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxl,
    borderRadius: Radius.lg,
  },
  buttonText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
});
