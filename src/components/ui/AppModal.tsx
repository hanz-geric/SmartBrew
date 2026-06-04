import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '../../constants/theme';

interface BaseProps {
  visible: boolean;
  title: string;
  body?: string;
}

interface InfoProps extends BaseProps {
  variant?: 'info';
  /** Dismiss handler for the single OK button / hardware back. */
  onClose: () => void;
  okText?: string;
}

interface ConfirmProps extends BaseProps {
  variant: 'confirm';
  onCancel: () => void;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type Props = InfoProps | ConfirmProps;

/**
 * Centered modal dialog promoted from the POS Info/Confirm modals so the same look is
 * reused app-wide. `variant="info"` shows a single OK button; `variant="confirm"` shows
 * Cancel + a (optionally danger) confirm button.
 */
export default function AppModal(props: Props) {
  const isConfirm = props.variant === 'confirm';
  const onRequestClose = isConfirm
    ? (props as ConfirmProps).onCancel
    : (props as InfoProps).onClose;

  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{props.title}</Text>
          {props.body ? <Text style={styles.body}>{props.body}</Text> : null}

          {isConfirm ? (
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={(props as ConfirmProps).onCancel}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelText}>
                  {(props as ConfirmProps).cancelText ?? 'Cancel'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, (props as ConfirmProps).danger && styles.confirmBtnDanger]}
                onPress={(props as ConfirmProps).onConfirm}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmText}>
                  {(props as ConfirmProps).confirmText ?? 'Confirm'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={(props as InfoProps).onClose}
              activeOpacity={0.8}
            >
              <Text style={styles.confirmText}>{(props as InfoProps).okText ?? 'OK'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  sheet: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.lg,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
  },
  body: {
    fontSize: FontSize.base,
    color: Colors.gray600,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray600,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.green600,
    alignItems: 'center',
  },
  confirmBtnDanger: {
    backgroundColor: Colors.danger,
  },
  confirmText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
});
