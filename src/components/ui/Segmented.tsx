import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, radius, shadow, useStyles, useTheme } from '../../theme';
import Press from './Press';

interface Props<T extends string | number> {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
}

/**
 * A row of mutually exclusive choices. The selected option sits on a raised
 * pill inside a recessed track, so the current choice reads at a glance.
 */
export default function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: Props<T>) {
  const styles = useStyles(makeStyles);
  const { colors, dark } = useTheme();
  return (
    <View style={styles.track}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Press
            key={String(option)}
            onPress={() => onChange(option)}
            scaleTo={0.97}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label(option)}
            style={[styles.segment, active && [styles.segmentActive, shadow(1, dark)]]}
          >
            <Text
              style={[styles.label, { color: active ? colors.onPrimary : colors.textMuted }]}
              numberOfLines={1}
            >
              {label(option)}
            </Text>
          </Press>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      backgroundColor: colors.cellPeer,
      borderRadius: radius.md,
      padding: 4,
    },
    segment: {
      flex: 1,
      paddingVertical: 9,
      paddingHorizontal: 4,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentActive: {
      backgroundColor: colors.primary,
    },
    label: {
      fontSize: 13,
      fontWeight: '700',
    },
  });
