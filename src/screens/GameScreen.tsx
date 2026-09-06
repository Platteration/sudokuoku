import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Board from '../components/Board';
import Controls from '../components/Controls';
import HelpSheet from '../components/HelpSheet';
import NumberPad from '../components/NumberPad';
import SettingsSheet from '../components/SettingsSheet';
import ShiftBanner from '../components/ShiftBanner';
import WinSheet from '../components/WinSheet';
import {
  Action,
  DEFAULT_SETTINGS,
  Difficulty,
  GameState,
  newGame,
  reduce,
  remainingCounts,
} from '../engine';
import { loadGame, saveGame } from '../storage';
import { colors, radius } from '../theme';
import { formatTime } from '../utils/time';

type Loaded = { state: GameState; elapsed: number };

function haptic(kind: 'shift' | 'win' | 'tap') {
  if (Platform.OS === 'web') return;
  const run =
    kind === 'shift'
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      : kind === 'win'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : Haptics.selectionAsync();
  run.catch(() => undefined);
}

export default function GameScreen() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGame().then((saved) => {
      if (cancelled) return;
      if (saved && saved.state.status === 'playing') {
        setLoaded({ state: saved.state, elapsed: saved.elapsed });
      } else {
        const settings = saved ? saved.state.settings : DEFAULT_SETTINGS;
        setLoaded({ state: newGame({ ...DEFAULT_SETTINGS, ...settings }), elapsed: 0 });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Shuffling the digits…</Text>
      </View>
    );
  }
  return <Game initial={loaded} />;
}

function Game({ initial }: { initial: Loaded }) {
  const [state, dispatch] = useReducer(reduce, initial.state);
  const [elapsed, setElapsed] = useState(initial.elapsed);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const boardSize = Math.floor(Math.min(width - 24, height * 0.5));

  // Timer: ticks while playing and the app is in the foreground.
  const appActive = useRef(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      appActive.current = s === 'active';
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (state.status !== 'playing') return;
    const id = setInterval(() => {
      if (appActive.current) setElapsed((e) => e + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [state.status]);

  // Persist on every board change (and every 10s for the timer).
  useEffect(() => {
    saveGame({ state, elapsed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.version, state.seed, state.settings, state.status]);
  useEffect(() => {
    if (elapsed % 10 === 0) saveGame({ state, elapsed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  // Feedback when a shift lands or the puzzle is solved.
  const lastShiftCount = useRef(state.shiftCount);
  useEffect(() => {
    if (state.shiftCount > lastShiftCount.current) haptic('shift');
    lastShiftCount.current = state.shiftCount;
  }, [state.shiftCount]);
  useEffect(() => {
    if (state.status === 'won') {
      haptic('win');
      setShowWin(true);
    }
  }, [state.status]);

  const send = useCallback((action: Action) => dispatch(action), []);

  const startNewGame = useCallback(
    (difficulty?: Difficulty) => {
      dispatch({ type: 'newGame', settings: difficulty ? { difficulty } : undefined });
      setElapsed(0);
      setShowWin(false);
    },
    [],
  );

  const confirmNewGame = () => {
    if (state.status === 'won' || state.moves === 0) {
      startNewGame();
      return;
    }
    Alert.alert('Start a new game?', 'Your current board will be lost.', [
      { text: 'Keep playing', style: 'cancel' },
      { text: 'New game', style: 'destructive', onPress: () => startNewGame() },
    ]);
  };

  const playing = state.status === 'playing';
  const remaining = remainingCounts(state);
  const difficultyLabel =
    state.settings.difficulty[0].toUpperCase() + state.settings.difficulty.slice(1);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Sudokuoku</Text>
          <Text style={styles.subtitle}>{difficultyLabel} · shifting board</Text>
        </View>
        <View style={styles.headerButtons}>
          <HeaderButton label="?" a11y="How to play" onPress={() => setShowHelp(true)} />
          <HeaderButton label="⚙" a11y="Settings" onPress={() => setShowSettings(true)} />
          <HeaderButton label="＋" a11y="New game" onPress={confirmNewGame} />
        </View>
      </View>

      <View style={styles.statsRow}>
        <Stat label="Time" value={formatTime(elapsed)} />
        <Stat label="Moves" value={String(state.moves)} />
        <Stat label="Shifts" value={String(state.shiftCount)} />
        <Stat label="Left" value={String(state.values.filter((v) => v === 0).length)} />
      </View>

      <ShiftBanner shift={state.lastShift} shiftCount={state.shiftCount} moves={state.moves} />

      <View style={styles.boardWrap}>
        <Board
          state={state}
          size={boardSize}
          onSelect={(pos) => {
            haptic('tap');
            send({ type: 'select', pos });
          }}
        />
      </View>

      <View style={styles.bottom}>
        <Controls
          notesMode={state.notesMode}
          canUndo={state.history.length > 0}
          disabled={!playing}
          onUndo={() => send({ type: 'undo' })}
          onErase={() => send({ type: 'erase' })}
          onToggleNotes={() => send({ type: 'toggleNotesMode' })}
          onHint={() => send({ type: 'hint' })}
        />
        <View style={{ height: 10 }} />
        <NumberPad
          remaining={remaining}
          notesMode={state.notesMode}
          disabled={!playing || state.selected === null}
          onDigit={(d) => send({ type: 'input', digit: d })}
        />
      </View>

      <SettingsSheet
        visible={showSettings}
        settings={state.settings}
        onClose={() => setShowSettings(false)}
        onChange={(patch) => send({ type: 'updateSettings', settings: patch })}
        onNewGame={(difficulty) => startNewGame(difficulty)}
      />
      <HelpSheet visible={showHelp} onClose={() => setShowHelp(false)} />
      <WinSheet
        visible={showWin}
        state={state}
        elapsed={elapsed}
        onClose={() => setShowWin(false)}
        onNewGame={() => startNewGame()}
      />
    </View>
  );
}

function HeaderButton({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
      style={({ pressed }) => [styles.headerButton, pressed && { backgroundColor: colors.primarySoft }]}
    >
      <Text style={styles.headerButtonText}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: colors.textMuted,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
  },
  headerButtons: {
    flexDirection: 'row',
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginLeft: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonText: {
    fontSize: 18,
    color: colors.text,
  },
  statsRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 6,
    marginHorizontal: 2,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  boardWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  bottom: {
    width: '100%',
  },
});
