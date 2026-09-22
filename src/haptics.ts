import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

let enabled = true;

/** Set from the Vibration setting; every haptic is skipped entirely while off. */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export type HapticKind = 'shift' | 'win' | 'tap';

/** Best-effort haptic feedback: nothing on the web, when off, or when unsupported. */
export function haptic(kind: HapticKind): void {
  if (Platform.OS === 'web' || !enabled) return;
  const run =
    kind === 'shift'
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      : kind === 'win'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : Haptics.selectionAsync();
  run.catch(() => undefined);
}
