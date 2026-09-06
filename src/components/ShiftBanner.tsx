import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { ShiftEvent, ShiftKind } from '../engine';
import { colors, radius } from '../theme';

interface Props {
  shift: ShiftEvent | null;
  shiftCount: number;
  moves: number;
}

const ICONS: Record<ShiftKind, string> = {
  'band-rows': '⇅',
  'stack-cols': '⇄',
  bands: '⤓',
  stacks: '⤏',
  rotate: '↻',
  mirror: '⇔',
  'box-slide': '▦',
  relabel: '#',
};

/** Announces the most recent shift and pops each time a new one lands. */
export default function ShiftBanner({ shift, shiftCount, moves }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const lastCount = useRef(shiftCount);

  useEffect(() => {
    if (shiftCount === lastCount.current) return;
    lastCount.current = shiftCount;
    scale.setValue(0.92);
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [shiftCount, scale]);

  const text = shift
    ? shift.description
    : moves === 0
      ? 'Make a move. Something will shift.'
      : 'The board held still.';

  return (
    <Animated.View style={[styles.banner, { transform: [{ scale }] }]}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>{shift ? ICONS[shift.kind] : '?'}</Text>
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={2}>
          {text}
        </Text>
        <Text style={styles.subtitle}>
          {shift ? `Shift ${shiftCount} · after move ${shift.afterMove}` : 'No shifts yet'}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.shiftBanner,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    width: '100%',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  icon: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    color: '#c7cad3',
    fontSize: 12,
    marginTop: 2,
  },
});
