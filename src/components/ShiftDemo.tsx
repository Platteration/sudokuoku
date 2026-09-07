import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  DEFAULT_SETTINGS,
  GameState,
  SHIFT_KIND_LABEL,
  Shift,
  ShiftKind,
  applyShift,
  bandRowsShift,
  boxSlideShift,
  bandsShift,
  mirrorShift,
  newGame,
  relabelShift,
  rotateShift,
  stackColsShift,
  stacksShift,
} from '../engine';
import { Colors, radius, useStyles, useTheme } from '../theme';
import Board from './Board';
import Icon from './ui/Icon';
import Press from './ui/Press';

interface Props {
  size: number;
  /** The demo only runs while its sheet is open. */
  playing: boolean;
  reduceMotion?: boolean;
}

/** One clear, deterministic example of each shift kind, in teaching order. */
const STEPS: { kind: ShiftKind; shift: Shift }[] = [
  { kind: 'band-rows', shift: bandRowsShift(0, 1) },
  { kind: 'stack-cols', shift: stackColsShift(2, 1) },
  { kind: 'bands', shift: bandsShift(1) },
  { kind: 'stacks', shift: stacksShift(1) },
  { kind: 'box-slide', shift: boxSlideShift(1, 0) },
  { kind: 'rotate', shift: rotateShift(1) },
  { kind: 'mirror', shift: mirrorShift('vertical') },
  { kind: 'relabel', shift: relabelShift(1) },
];

const STEP_MS = 2400;

/**
 * A small board that cycles through every shift kind so the movement can be
 * watched rather than read about. The board is a finished grid, which makes
 * each move obvious, and it is driven by the real shift transforms, so what
 * it shows is exactly what the game does.
 */
export default function ShiftDemo({ size, playing, reduceMotion }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();

  const start = useMemo<GameState>(() => {
    const base = newGame(
      { ...DEFAULT_SETTINGS, difficulty: 'easy', enabledShifts: [], animateShifts: true },
      20260906,
    );
    return {
      ...base,
      values: base.solution.slice(),
      given: base.solution.map(() => true),
      settings: { ...base.settings, animateShifts: !reduceMotion, reduceMotion: !!reduceMotion },
    };
  }, [reduceMotion]);

  const [state, setState] = useState<GameState>(start);
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(true);
  const stepRef = useRef(0);

  // Rebuild when the motion preference changes.
  useEffect(() => {
    setState(start);
    setStep(0);
    stepRef.current = 0;
  }, [start]);

  const advance = React.useCallback(() => {
    const next = STEPS[stepRef.current % STEPS.length];
    stepRef.current += 1;
    setStep(stepRef.current);
    setState((s) => applyShift(s, next.shift));
  }, []);

  useEffect(() => {
    if (!playing || !running) return;
    const id = setInterval(advance, STEP_MS);
    return () => clearInterval(id);
  }, [playing, running, advance]);

  // The caption describes the shift that was just applied.
  const current = step === 0 ? null : STEPS[(step - 1) % STEPS.length];

  return (
    <View style={styles.wrap}>
      <View style={styles.boardWrap}>
        <Board state={state} size={size} onSelect={() => undefined} />
      </View>
      <View style={styles.caption}>
        <Text style={styles.captionTitle} numberOfLines={1}>
          {current ? SHIFT_KIND_LABEL[current.kind] : 'A finished board, about to move'}
        </Text>
        <Text style={styles.captionText} numberOfLines={2}>
          {current ? current.shift.description : 'Watch each kind of shift in turn.'}
        </Text>
      </View>
      <View style={styles.controls}>
        <Press
          onPress={() => setRunning((r) => !r)}
          accessibilityRole="button"
          accessibilityLabel={running ? 'Pause the demo' : 'Play the demo'}
          style={styles.button}
        >
          <Icon name={running ? 'pause' : 'play'} size={14} color={colors.text} />
          <Text style={styles.buttonText}>{running ? 'Pause' : 'Play'}</Text>
        </Press>
        <Press
          onPress={advance}
          accessibilityRole="button"
          accessibilityLabel="Show the next shift"
          style={styles.button}
        >
          <Icon name="next" size={14} color={colors.text} />
          <Text style={styles.buttonText}>Next</Text>
        </Press>
        <View style={styles.dots}>
          {STEPS.map((s, i) => (
            <View
              key={s.kind}
              style={[styles.dot, step > 0 && (step - 1) % STEPS.length === i && styles.dotActive]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      padding: 12,
      marginTop: 4,
      marginBottom: 8,
    },
    boardWrap: {
      alignItems: 'center',
    },
    caption: {
      marginTop: 10,
      minHeight: 40,
    },
    captionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    captionText: {
      fontSize: 13,
      color: colors.textMuted,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.surface,
      marginRight: 6,
    },
    buttonText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      marginLeft: 6,
    },
    dots: {
      flexDirection: 'row',
      flex: 1,
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.line,
      marginLeft: 4,
    },
    dotActive: {
      backgroundColor: colors.primary,
      width: 10,
      borderRadius: 5,
    },
  });
