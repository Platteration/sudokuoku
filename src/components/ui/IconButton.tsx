import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Colors, radius, shadow, useStyles, useTheme } from '../../theme';
import Icon, { IconName } from './Icon';
import Press from './Press';

interface Props {
  name: IconName;
  label: string;
  onPress: () => void;
  /** Draws a small dot in the corner, for "something is waiting here". */
  badge?: boolean;
  active?: boolean;
  size?: number;
}

/** The round icon button used across the header and sheet corners. */
export default function IconButton({ name, label, onPress, badge, active, size = 36 }: Props) {
  const styles = useStyles(makeStyles);
  const { colors, dark } = useTheme();
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      hitSlop={6}
      style={[
        styles.button,
        { width: size, height: size, borderRadius: size / 2 },
        active && { backgroundColor: colors.primarySoft, borderColor: colors.primary },
        shadow(1, dark),
      ]}
    >
      <Icon name={name} size={size * 0.46} color={active ? colors.primary : colors.text} />
      {badge ? <View style={styles.badge} /> : null}
    </Press>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    button: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 5,
    },
    badge: {
      position: 'absolute',
      top: 1,
      right: 1,
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.danger,
      borderWidth: 2,
      borderColor: colors.surface,
    },
  });
