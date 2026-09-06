import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';

interface Props {
  remaining: number[];
  notesMode: boolean;
  disabled: boolean;
  onDigit: (d: number) => void;
}

export default function NumberPad({ remaining, notesMode, disabled, onDigit }: Props) {
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
        const done = remaining[d] <= 0 && !notesMode;
        return (
          <Pressable
            key={d}
            disabled={disabled || done}
            onPress={() => onDigit(d)}
            accessibilityRole="button"
            accessibilityLabel={`Enter ${d}`}
            style={({ pressed }) => [
              styles.key,
              notesMode && styles.keyNotes,
              (done || disabled) && styles.keyDone,
              pressed && styles.keyPressed,
            ]}
          >
            <Text style={[styles.digit, notesMode && styles.digitNotes]}>{d}</Text>
            <Text style={styles.count}>{done ? '' : remaining[d]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  key: {
    flex: 1,
    marginHorizontal: 2,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
  keyNotes: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  keyDone: {
    opacity: 0.3,
  },
  keyPressed: {
    backgroundColor: colors.primarySoft,
  },
  digit: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.primary,
  },
  digitNotes: {
    color: colors.text,
    fontSize: 18,
  },
  count: {
    fontSize: 11,
    color: colors.textMuted,
    height: 14,
  },
});
