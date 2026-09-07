import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, radius, shadow, useStyles, useTheme } from '../theme';
import Icon, { IconName } from './ui/Icon';
import Press from './ui/Press';

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
  icon: IconName;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function ControlButton({ label, icon, active, disabled, onPress }: ButtonProps) {
  const styles = useStyles(makeStyles);
  const { colors, dark } = useTheme();
  const fg = disabled ? colors.textMuted : active ? colors.onPrimary : colors.text;
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      style={[
        styles.button,
        active && styles.buttonActive,
        !disabled && shadow(1, dark),
        disabled && styles.buttonOff,
      ]}
    >
      <Icon name={icon} size={21} color={fg} />
      <Text style={[styles.label, { color: active ? colors.onPrimary : colors.textMuted }]}>
        {label}
      </Text>
      {active ? <View style={styles.activeDot} /> : null}
    </Press>
  );
}

export default function Controls(p: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.row}>
      <ControlButton label="Undo" icon="undo" disabled={!p.canUndo || p.disabled} onPress={p.onUndo} />
      <ControlButton label="Erase" icon="erase" disabled={p.disabled} onPress={p.onErase} />
      <ControlButton
        label="Notes"
        icon={p.notesMode ? 'notesOn' : 'notes'}
        active={p.notesMode}
        disabled={p.disabled}
        onPress={p.onToggleNotes}
      />
      <ControlButton label="Hint" icon="hint" disabled={p.disabled} onPress={p.onHint} />
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      width: '100%',
    },
    button: {
      flex: 1,
      marginHorizontal: 3,
      paddingVertical: 10,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.line,
    },
    buttonActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    buttonOff: {
      opacity: 0.4,
    },
    label: {
      fontSize: 11,
      fontWeight: '600',
      marginTop: 3,
    },
    activeDot: {
      position: 'absolute',
      top: 6,
      right: 8,
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.onPrimary,
    },
  });
