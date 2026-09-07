import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { useTheme } from '../../theme';

/**
 * The app's icon vocabulary. Naming them here keeps every screen using the
 * same glyph for the same idea, and keeps the icon set swappable in one place.
 */
export const ICONS = {
  undo: 'arrow-undo-outline',
  erase: 'backspace-outline',
  notes: 'pencil-outline',
  notesOn: 'pencil',
  hint: 'bulb-outline',
  daily: 'calendar-outline',
  progress: 'trophy-outline',
  settings: 'settings-outline',
  add: 'add',
  close: 'close',
  share: 'share-outline',
  play: 'play',
  pause: 'pause',
  next: 'play-skip-forward',
  check: 'checkmark',
  help: 'help-circle-outline',
  flame: 'flame',
  snow: 'snow-outline',
  lock: 'lock-closed',
  ghost: 'ellipse-outline',
  chevron: 'chevron-forward',
  // Preset marks
  zen: 'leaf-outline',
  dice: 'grid-outline',
  phantomMode: 'eye-off-outline',
  blindfold: 'glasses-outline',
  chaos: 'flash-outline',
} as const;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  size?: number;
  color?: string;
}

export default function Icon({ name, size = 20, color }: Props) {
  const { colors } = useTheme();
  return <Ionicons name={ICONS[name]} size={size} color={color ?? colors.text} />;
}
