import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import type { ReduceMotion } from './engine';

/**
 * Reports whether the platform asks for less motion, now and whenever it
 * changes, until the returned function is called. Two guards the sources
 * force: react-native-web's `AccessibilityInfo` answers *true* when
 * `matchMedia` is missing (jsdom, old browsers) and its listener returns
 * nothing to remove, so the web path reads `prefers-reduced-motion` itself
 * and a page without `matchMedia` means no preference; and the native call
 * *rejects* when its module is absent (a test renderer), which also means no
 * preference rather than an error.
 */
export function watchSystemReduceMotion(onChange: (reduced: boolean) => void): () => void {
  if (Platform.OS === 'web') {
    const media =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    if (!media) {
      onChange(false);
      return () => undefined;
    }
    const update = () => onChange(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }
  let live = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((reduced) => {
      if (live) onChange(reduced);
    })
    .catch(() => {
      if (live) onChange(false);
    });
  const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) => {
    if (live) onChange(reduced);
  });
  return () => {
    live = false;
    subscription?.remove?.();
  };
}

/** The yes-or-no the animations need, from a three-way setting and the system's answer. */
export function resolveReduceMotion(setting: ReduceMotion, system: boolean): boolean {
  return setting === 'system' ? system : setting === 'on';
}

/**
 * Whether to skip decorative motion right now: the setting when it is `on` or
 * `off`, and the device's own preference, followed live, when it is `system`.
 */
export function useReduceMotion(setting: ReduceMotion): boolean {
  const [system, setSystem] = useState(false);
  useEffect(() => {
    if (setting !== 'system') return undefined;
    return watchSystemReduceMotion(setSystem);
  }, [setting]);
  return resolveReduceMotion(setting, system);
}
