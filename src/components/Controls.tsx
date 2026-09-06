import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';

interface Props {
  notesMode: boolean;
  canUndo: boolean;
  disabled: boolean;
  onUndo: () => void;
  onErase: () => void;
  onToggleNotes: () => void;
  onHint: () => void;
}

interface ButtonProps {
  label: string;
  icon: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function ControlButton({ label, icon, active, disabled, onPress }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.icon, active && styles.iconActive]}>{icon}</Text>
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </Pressable>
  );
}

export default function Controls(p: Props) {
  return (
    <View style={styles.row}>
      <ControlButton label="Undo" icon="↶" disabled={!p.canUndo || p.disabled} onPress={p.onUndo} />
      <ControlButton label="Erase" icon="⌫" disabled={p.disabled} onPress={p.onErase} />
      <ControlButton
        label={p.notesMode ? 'Notes on' : 'Notes'}
        icon="✎"
        active={p.notesMode}
        disabled={p.disabled}
        onPress={p.onToggleNotes}
      />
      <ControlButton label="Hint" icon="💡" disabled={p.disabled} onPress={p.onHint} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  button: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
  buttonActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    backgroundColor: colors.primarySoft,
  },
  icon: {
    fontSize: 20,
    color: colors.text,
  },
  iconActive: {
    color: colors.text,
  },
  label: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  labelActive: {
    color: colors.text,
    fontWeight: '600',
  },
});
