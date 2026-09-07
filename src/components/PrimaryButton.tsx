import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Colors, radius, shadow, useStyles, useTheme } from '../theme';
import Icon, { IconName } from './ui/Icon';
import Press from './ui/Press';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

interface Props {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
}

export default function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  disabled,
  busy,
}: Props) {
  const styles = useStyles(makeStyles);
  const { colors, dark } = useTheme();

  const tone = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: 'transparent', lift: 2 as const },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.line, lift: 1 as const },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: 'transparent', lift: 0 as const },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: colors.danger, lift: 0 as const },
  }[variant];

  const off = disabled || busy;

  return (
    <Press
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={[
        styles.button,
        size === 'md' && styles.md,
        {
          backgroundColor: tone.bg,
          borderColor: tone.border,
          borderWidth: tone.border === 'transparent' ? 0 : 1,
        },
        tone.lift > 0 && shadow(tone.lift, dark),
        off && styles.off,
      ]}
    >
      <View style={styles.row}>
        {busy ? (
          <ActivityIndicator size="small" color={tone.fg} style={styles.leading} />
        ) : icon ? (
          <View style={styles.leading}>
            <Icon name={icon} size={size === 'md' ? 16 : 18} color={tone.fg} />
          </View>
        ) : null}
        <Text style={[styles.label, size === 'md' && styles.labelMd, { color: tone.fg }]}>
          {label}
        </Text>
      </View>
    </Press>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    button: {
      borderRadius: radius.md,
      paddingVertical: 15,
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    md: {
      paddingVertical: 11,
      paddingHorizontal: 14,
      borderRadius: radius.sm,
    },
    off: {
      opacity: 0.45,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    leading: {
      marginRight: 8,
    },
    label: {
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
    labelMd: {
      fontSize: 14,
    },
  });
