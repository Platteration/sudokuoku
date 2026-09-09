import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CELLS,
  GameState,
  Phantom,
  boxOf,
  colOf,
  findConflicts,
  isLocked,
  mistakes,
  rowOf,
} from '../engine';
import { Colors, useStyles, useTheme } from '../theme';
import { cellContent } from '../utils/cellContent';
import { describeCell } from '../utils/describe';

interface Props {
  state: GameState;
  size: number;
  onSelect: (pos: number) => void;
}

const SHIFT_MS = 420;

/** Opacity a phantom's digit should have right now, given wall-clock time. */
function fadeProgress(ph: Phantom, now: number): number {
  if (ph.fadeMs <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - (now - ph.startedAt) / ph.fadeMs));
}

/**
 * The board is drawn in two layers. The bottom layer is one static, tappable
 * square per position and carries all position-based highlighting. The top
 * layer is one animated square per cell *token*; tokens keep their identity
 * across shifts, so when the board shifts each token glides from its old
 * spot to its new one.
 */
export default function Board({ state, size, onSelect }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const cell = size / 9;
  const { tokens, values, given, selected, settings, phantoms, moves, lastShift } = state;

  // Cells that just received a moved digit flash briefly after each shift.
  const flash = useRef(new Animated.Value(0)).current;
  const lastFlashed = useRef(state.shiftCount);
  const movedTo = useMemo(() => {
    const set = new Set<number>();
    if (!lastShift || settings.reduceMotion) return set;
    lastShift.dest.forEach((to, from) => {
      if (to !== from) set.add(to);
    });
    return set;
  }, [lastShift, settings.reduceMotion]);
  useEffect(() => {
    if (state.shiftCount === lastFlashed.current) return;
    lastFlashed.current = state.shiftCount;
    flash.setValue(0.9);
    Animated.timing(flash, {
      toValue: 0,
      duration: SHIFT_MS + 500,
      delay: settings.animateShifts ? SHIFT_MS : 0,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [state.shiftCount, settings.animateShifts, flash]);

  // One fade-out animation per phantom, keyed by the phantom's id so it
  // keeps running while the cell travels across the board during shifts.
  const fades = useRef(new Map<number, Animated.Value>()).current;
  const fadeFor = (ph: Phantom): Animated.Value => {
    let v = fades.get(ph.id);
    if (!v) {
      v = new Animated.Value(fadeProgress(ph, Date.now()));
      fades.set(ph.id, v);
    }
    return v;
  };
  useEffect(() => {
    const live = new Set<number>();
    const now = Date.now();
    for (const ph of phantoms) {
      if (!ph) continue;
      live.add(ph.id);
      const remaining = ph.startedAt + ph.fadeMs - now;
      const v = fadeFor(ph);
      if (remaining > 0) {
        Animated.timing(v, {
          toValue: 0,
          duration: remaining,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }).start();
      } else {
        v.setValue(0);
      }
    }
    for (const id of [...fades.keys()]) if (!live.has(id)) fades.delete(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phantoms]);

  const positions = useRef<Animated.ValueXY[] | null>(null);
  if (positions.current === null) {
    positions.current = Array.from({ length: CELLS }, () => new Animated.ValueXY());
    tokens.forEach((token, pos) => {
      positions.current![token].setValue({ x: colOf(pos) * cell, y: rowOf(pos) * cell });
    });
  }
  const prevCell = useRef(cell);
  const prevTokens = useRef(tokens);

  useEffect(() => {
    const anims: Animated.CompositeAnimation[] = [];
    const sizeChanged = prevCell.current !== cell;
    const tokensChanged = prevTokens.current !== tokens;
    tokens.forEach((token, pos) => {
      const target = { x: colOf(pos) * cell, y: rowOf(pos) * cell };
      const v = positions.current![token];
      if (tokensChanged && settings.animateShifts && !settings.reduceMotion && !sizeChanged) {
        anims.push(
          Animated.timing(v, {
            toValue: target,
            duration: SHIFT_MS,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
        );
      } else {
        v.setValue(target);
      }
    });
    prevCell.current = cell;
    prevTokens.current = tokens;
    if (anims.length) Animated.parallel(anims).start();
  }, [tokens, cell, settings.animateShifts, settings.reduceMotion]);

  const conflicts = useMemo(
    () => (settings.highlightConflicts ? findConflicts(values) : new Set<number>()),
    [values, settings.highlightConflicts],
  );
  const wrong = useMemo(
    () => (settings.showMistakes ? mistakes(state) : new Set<number>()),
    [state, settings.showMistakes],
  );

  const selectedDigit = selected === null ? 0 : values[selected];
  const selRow = selected === null ? -1 : rowOf(selected);
  const selCol = selected === null ? -1 : colOf(selected);
  const selBox = selected === null ? -1 : boxOf(selected);

  const backgroundFor = (pos: number): string => {
    if (pos === selected) return colors.cellSelected;
    if (conflicts.has(pos)) return colors.cellConflict;
    if (settings.phantomMarkers && isLocked(state, pos)) return colors.cellPhantom;
    if (selectedDigit !== 0 && values[pos] === selectedDigit) return colors.cellSameDigit;
    if (selected !== null) {
      if (rowOf(pos) === selRow || colOf(pos) === selCol || boxOf(pos) === selBox)
        return colors.cellPeer;
    }
    return colors.surface;
  };

  const digitColor = (pos: number): string => {
    if (given[pos]) return colors.given;
    if (wrong.has(pos) || conflicts.has(pos)) return colors.danger;
    return colors.entry;
  };

  const lines = [3, 6].map((i) => i * cell);

  return (
    <View style={[styles.board, { width: size, height: size }]}>
      {/* Static, tappable, position-based layer. */}
      {Array.from({ length: CELLS }, (_, pos) => (
        <Pressable
          key={pos}
          onPress={() => onSelect(pos)}
          accessibilityRole="button"
          accessibilityLabel={describeCell(state, pos)}
          accessibilityState={{ selected: pos === selected, disabled: isLocked(state, pos) }}
          style={[
            styles.cell,
            {
              left: colOf(pos) * cell,
              top: rowOf(pos) * cell,
              width: cell,
              height: cell,
              backgroundColor: backgroundFor(pos),
            },
          ]}
        />
      ))}
      {/* Post-shift flash on the cells that received a moved digit. */}
      {[...movedTo].map((pos) => (
        <Animated.View
          key={`f${pos}`}
          pointerEvents="none"
          style={[
            styles.flash,
            {
              left: colOf(pos) * cell,
              top: rowOf(pos) * cell,
              width: cell,
              height: cell,
              opacity: flash,
            },
          ]}
        />
      ))}
      {/* The selection ring is drawn above the cells so it survives the
          peer and conflict tints, and makes the current cell easy to find
          again once the board has moved. */}
      {selected !== null ? (
        <View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              left: colOf(selected) * cell,
              top: rowOf(selected) * cell,
              width: cell,
              height: cell,
            },
          ]}
        />
      ) : null}
      {/* Thick box lines. */}
      {lines.map((offset) => (
        <View
          key={`h${offset}`}
          pointerEvents="none"
          style={[styles.thickLine, { top: offset - 1, left: 0, width: size, height: 2 }]}
        />
      ))}
      {lines.map((offset) => (
        <View
          key={`v${offset}`}
          pointerEvents="none"
          style={[styles.thickLine, { left: offset - 1, top: 0, height: size, width: 2 }]}
        />
      ))}
      {/* Moving, token-based layer. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {tokens.map((token, pos) => {
          const { phantom, marker, value, notes: note } = cellContent(state, pos);
          const v = positions.current![token];
          const fade = phantom ? fadeFor(phantom) : null;
          return (
            <Animated.View
              key={token}
              style={[
                styles.token,
                {
                  width: cell,
                  height: cell,
                  transform: [{ translateX: v.x }, { translateY: v.y }],
                },
              ]}
            >
              {/* The faded digit and its marker sit above the cell rather than
                  instead of it: once the lock runs out the record lingers to
                  score the recall, and the cell is playable again meanwhile. */}
              {phantom && fade ? (
                <View style={styles.phantomLayer}>
                  <Animated.Text
                    style={[
                      styles.digit,
                      styles.phantomDigit,
                      {
                        fontSize: cell * 0.58,
                        color: phantom.wasGiven ? colors.given : colors.entry,
                        fontWeight: phantom.wasGiven ? '700' : '500',
                        opacity: fade,
                      },
                    ]}
                  >
                    {phantom.value}
                  </Animated.Text>
                  {marker ? (
                    <Animated.View
                      style={[
                        styles.marker,
                        { opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
                      ]}
                    >
                      <Text style={[styles.markerGlyph, { fontSize: cell * 0.42 }]}>◌</Text>
                      <Text style={[styles.markerCount, { fontSize: cell * 0.26 }]}>
                        {phantom.unlockAtMove - moves}
                      </Text>
                    </Animated.View>
                  ) : null}
                </View>
              ) : null}
              {value !== 0 ? (
                <Text
                  style={[
                    styles.digit,
                    {
                      fontSize: cell * 0.58,
                      color: digitColor(pos),
                      fontWeight: given[pos] ? '700' : '500',
                    },
                  ]}
                >
                  {value}
                </Text>
              ) : note !== 0 ? (
                <View style={styles.notes}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                    <Text
                      key={d}
                      style={[
                        styles.note,
                        { width: cell / 3, height: cell / 3, fontSize: cell * 0.24, lineHeight: cell / 3 },
                      ]}
                    >
                      {note & (1 << d) ? d : ''}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  board: {
    borderWidth: 2,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cell: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  flash: {
    position: 'absolute',
    backgroundColor: colors.primarySoft,
  },
  ring: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: colors.primary,
    borderRadius: 3,
  },
  thickLine: {
    position: 'absolute',
    backgroundColor: colors.lineStrong,
  },
  token: {
    position: 'absolute',
    left: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    fontVariant: ['tabular-nums'],
  },
  phantomLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phantomDigit: {
    position: 'absolute',
  },
  marker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerGlyph: {
    color: colors.phantom,
    lineHeight: undefined,
  },
  markerCount: {
    color: colors.phantom,
    fontWeight: '700',
    marginTop: -2,
  },
  notes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    height: '100%',
  },
  note: {
    textAlign: 'center',
    color: colors.textMuted,
  },
  });
