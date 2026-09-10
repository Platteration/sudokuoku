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
  joinDescriptions,
} from '../engine';
import { Colors, radius, useStyles } from '../theme';

interface Props {
  shift: ShiftEvent | null;
  shiftCount: number;
  moves: number;
  reduceMotion?: boolean;
  /** Every shift the next move will trigger, in order. */
  next?: readonly Shift[];
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
  next = [],
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

  // A move can fire several shifts, so the preview names all of them: telling
  // the player about the first of two is worse than telling them nothing.
  const showPreview = preview !== 'off';
  const category = next.length > 0 ? SHIFT_CATEGORY[next[0].kind] : null;
  const previewText = !showPreview
    ? null
    : next.length === 0
      ? 'Nothing moves after your next move'
      : preview === 'exact'
        ? joinDescriptions(next.map((sh) => sh.description))
        : joinDescriptions(
            next
              .map((sh) => CATEGORY_LABEL[SHIFT_CATEGORY[sh.kind]])
              .filter((label, i, all) => i === 0 || label !== all[i - 1]),
          );

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
          <Text style={styles.previewText} numberOfLines={2}>
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
