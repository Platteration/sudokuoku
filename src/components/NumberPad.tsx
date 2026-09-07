import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, radius, shadow, useStyles, useTheme } from '../theme';
import Icon from './ui/Icon';
import Press from './ui/Press';

interface Props {
  remaining: number[];
  notesMode: boolean;
  disabled: boolean;
  onDigit: (d: number) => void;
}

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function NumberPad({ remaining, notesMode, disabled, onDigit }: Props) {
  const styles = useStyles(makeStyles);
  const { colors, dark } = useTheme();

  return (
    <View style={styles.row}>
      {DIGITS.map((d) => {
        const left = remaining[d];
        const placed = left <= 0;
        // A digit that is fully placed stays tappable in notes mode, since a
        // pencil mark on it can still be useful while checking work.
        const off = disabled || (placed && !notesMode);
        return (
          <Press
            key={d}
            disabled={off}
            onPress={() => onDigit(d)}
            accessibilityRole="button"
            accessibilityLabel={`Enter ${d}`}
            accessibilityHint={placed ? 'All nine are placed' : `${left} left to place`}
            accessibilityState={{ disabled: off }}
            style={[
              styles.key,
              notesMode && styles.keyNotes,
              !off && shadow(1, dark),
              off && styles.keyOff,
            ]}
          >
            <Text
              style={[
                styles.digit,
                notesMode && styles.digitNotes,
                { color: notesMode ? colors.text : colors.primary },
              ]}
            >
              {d}
            </Text>
            <View style={styles.meter}>
              {placed ? (
                <Icon name="check" size={11} color={colors.success} />
              ) : (
                <Text style={styles.count}>{left}</Text>
              )}
            </View>
          </Press>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      width: '100%',
    },
    key: {
      flex: 1,
      marginHorizontal: 2.5,
      paddingTop: 9,
      paddingBottom: 5,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.line,
    },
    keyNotes: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    keyOff: {
      opacity: 0.4,
    },
    digit: {
      fontSize: 25,
      fontWeight: '700',
      lineHeight: 29,
      fontVariant: ['tabular-nums'],
    },
    digitNotes: {
      fontSize: 20,
      lineHeight: 29,
      fontWeight: '600',
    },
    meter: {
      height: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    count: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
      fontVariant: ['tabular-nums'],
    },
  });
