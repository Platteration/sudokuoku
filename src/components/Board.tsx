import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CELLS,
  GameState,
  boxOf,
  colOf,
  findConflicts,
  mistakes,
  rowOf,
} from '../engine';
import { colors } from '../theme';

interface Props {
  state: GameState;
  size: number;
  onSelect: (pos: number) => void;
}

const SHIFT_MS = 420;

/**
 * The board is drawn in two layers. The bottom layer is one static, tappable
 * square per position and carries all position-based highlighting. The top
 * layer is one animated square per cell *token*; tokens keep their identity
 * across shifts, so when the board shifts each token glides from its old
 * spot to its new one.
 */
export default function Board({ state, size, onSelect }: Props) {
  const cell = size / 9;
  const { tokens, values, given, notes, selected, settings } = state;

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
      if (tokensChanged && settings.animateShifts && !sizeChanged) {
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
  }, [tokens, cell, settings.animateShifts]);

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
          accessibilityLabel={`Row ${rowOf(pos) + 1} column ${colOf(pos) + 1}`}
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
          const value = values[pos];
          const note = notes[pos];
          const v = positions.current![token];
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

const styles = StyleSheet.create({
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
