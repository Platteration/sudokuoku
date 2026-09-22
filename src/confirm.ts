import { Alert, Platform } from 'react-native';

export interface Confirmation {
  title: string;
  message: string;
  /** The safe default, and the first button. */
  cancelLabel: string;
  /** Named with its verb: "Reset", "New game", never "OK". */
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * A two-button confirmation for an action that destroys something the app
 * cannot restore on its own. react-native-web implements Alert as an empty
 * stub, so a confirmation there does nothing at all and the button it guards
 * looks broken. The browser's own dialog stands in on that platform.
 */
export function confirmAction({ title, message, cancelLabel, confirmLabel, onConfirm }: Confirmation): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
