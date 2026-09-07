import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  SHIFT_CATEGORY,
  Shift,
  ShiftEvent,
  ShiftKind,
  ShiftPreview,
} from '../engine';
import { Colors, radius, useStyles } from '../theme';

interface Props {
  shift: ShiftEvent | null;
  shiftCount: number;
  moves: number;
  reduceMotion?: boolean;
  /** The shift the next move will trigger, if any. */
  next?: Shift | null;
  preview?: ShiftPreview;
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
export default function ShiftBanner({
  shift,
  shiftCount,
  moves,
  reduceMotion,
  next,
  preview = 'off',
}: Props) {
  const styles = useStyles(makeStyles);
  const scale = useRef(new Animated.Value(1)).current;
  const lastCount = useRef(shiftCount);

  useEffect(() => {
    if (shiftCount === lastCount.current) return;
    lastCount.current = shiftCount;
    if (reduceMotion) {
      scale.setValue(1);
      return;
    }
    scale.setValue(0.92);
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [shiftCount, scale, reduceMotion]);

  const text = shift
    ? shift.description
    : moves === 0
      ? 'Make a move. Something will shift.'
      : 'The board held still.';

  const showPreview = preview !== 'off';
  const category = next ? SHIFT_CATEGORY[next.kind] : null;
  const previewText = !showPreview
    ? null
    : !next
      ? 'Nothing moves after your next move'
      : preview === 'exact'
        ? next.description
        : CATEGORY_LABEL[SHIFT_CATEGORY[next.kind]];

  return (
    <Animated.View style={[styles.banner, { transform: [{ scale }] }]}>
      <View style={styles.row}>
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
      </View>
      {previewText ? (
        <View style={styles.preview}>
          <Text style={styles.previewIcon}>{category ? CATEGORY_ICON[category] : '·'}</Text>
          <Text style={styles.previewText} numberOfLines={1}>
            Next: {previewText}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  banner: {
    backgroundColor: colors.shiftBanner,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.onBannerMuted,
  },
  previewIcon: {
    color: colors.onBannerMuted,
    fontSize: 14,
    width: 22,
    textAlign: 'center',
  },
  previewText: {
    color: colors.onBannerMuted,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
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
    color: colors.onPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    color: colors.onBanner,
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.onBannerMuted,
    fontSize: 12,
    marginTop: 2,
  },
  });
