import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '../../constants/theme';

export type ToastType = 'success' | 'error' | 'info';

interface ToastApi {
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
}

interface ToastState {
  id: number;
  type: ToastType;
  message: string;
}

const DEFAULT_DURATION = 2800;

const TYPE_STYLE: Record<ToastType, { bg: string; icon: string }> = {
  success: { bg: Colors.green600, icon: '+' },
  error:   { bg: Colors.danger,   icon: '!' },
  info:    { bg: Colors.gray800,  icon: 'i' },
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Non-blocking toast notifications. Hand-rolled on RN Animated (no dependency): a single
 * banner anchored to the top safe-area, sliding/fading in and auto-dismissing. Replaces
 * blocking Alert.alert for transient success/error/info feedback.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const dismiss = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 200, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [opacity, translateY]);

  const show = useCallback(
    (type: ToastType, message: string, durationMs = DEFAULT_DURATION) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      idRef.current += 1;
      setToast({ id: idRef.current, type, message });

      translateY.setValue(-120);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8, tension: 80 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();

      hideTimer.current = setTimeout(dismiss, durationMs);
    },
    [dismiss, opacity, translateY],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, d) => show('success', m, d),
      error: (m, d) => show('error', m, d),
      info: (m, d) => show('info', m, d),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.wrapper, { top: insets.top + Spacing.sm, opacity, transform: [{ translateY }] }]}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={dismiss}
            style={[styles.toast, { backgroundColor: TYPE_STYLE[toast.type].bg }]}
          >
            <Text style={styles.icon}>{TYPE_STYLE[toast.type].icon}</Text>
            <Text style={styles.message} numberOfLines={3}>
              {toast.message}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

/** Access the toast API. Must be used under a <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: 520,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    ...Shadow.lg,
  },
  icon: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  message: {
    flexShrink: 1,
    color: Colors.white,
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
  },
});
