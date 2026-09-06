import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
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
import StatsSheet from '../components/StatsSheet';
import WinSheet from '../components/WinSheet';
import {
  Action,
  DEFAULT_SETTINGS,
  Difficulty,
  GameState,
  isLocked,
  newGame,
  reduce,
  remainingCounts,
} from '../engine';
import {
  EMPTY_STATS,
  Stats,
  clearStats,
  hasSeenHelp,
  loadGame,
  loadStats,
  markHelpSeen,
  recordStart,
  recordWin,
  saveGame,
  saveStats,
} from '../storage';
import { Colors, ThemeProvider, radius, useStyles, useTheme } from '../theme';
import { formatTime } from '../utils/time';

type Loaded = { state: GameState; elapsed: number; firstLaunch: boolean; stats: Stats };

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
    Promise.all([loadGame(), hasSeenHelp(), loadStats()]).then(([saved, seenHelp, stats]) => {
      if (cancelled) return;
      const firstLaunch = !seenHelp;
      if (saved && saved.state.status === 'playing') {
        setLoaded({ state: saved.state, elapsed: saved.elapsed, firstLaunch, stats });
      } else {
        const settings = saved ? saved.state.settings : DEFAULT_SETTINGS;
        const state = newGame({ ...DEFAULT_SETTINGS, ...settings });
        const started = recordStart(stats, state.settings.difficulty);
        saveStats(started);
        setLoaded({ state, elapsed: 0, firstLaunch, stats: started });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return (
      <ThemeProvider preference="system">
        <Loading />
      </ThemeProvider>
    );
  }
  return <Game initial={loaded} />;
}

function Loading() {
  const styles = useStyles(makeStyles);
  const { colors, dark } = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>Shuffling the digits…</Text>
      <StatusBar style={dark ? 'light' : 'dark'} />
    </View>
  );
}

function Game({ initial }: { initial: Loaded }) {
  const [state, dispatch] = useReducer(reduce, initial.state);
  return (
    <ThemeProvider preference={state.settings.theme}>
      <GameView state={state} dispatch={dispatch} initial={initial} />
    </ThemeProvider>
  );
}

function GameView({
  state,
  dispatch,
  initial,
}: {
  state: GameState;
  dispatch: React.Dispatch<Action>;
  initial: Loaded;
}) {
  const styles = useStyles(makeStyles);
  const { colors, dark } = useTheme();
  const [elapsed, setElapsed] = useState(initial.elapsed);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(initial.firstLaunch);
  const [showWin, setShowWin] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<Stats>(initial.stats);
  const updateStats = useCallback((next: Stats) => {
    setStats(next);
    saveStats(next);
  }, []);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // The board fills whatever space is left between the banner and the pad.
  const [boardArea, setBoardArea] = useState({ w: width - 24, h: height * 0.5 });
  const boardSize = Math.max(200, Math.floor(Math.min(boardArea.w, boardArea.h) - 4));

  const closeHelp = () => {
    setShowHelp(false);
    markHelpSeen();
  };

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
  const wonSeed = useRef<number | null>(null);
  useEffect(() => {
    if (state.status === 'won' && wonSeed.current !== state.seed) {
      wonSeed.current = state.seed;
      haptic('win');
      setShowWin(true);
      updateStats(recordWin(stats, state, elapsed));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.seed]);

  const send = useCallback((action: Action) => dispatch(action), []);

  const startNewGame = useCallback(
    (difficulty?: Difficulty) => {
      dispatch({ type: 'newGame', settings: difficulty ? { difficulty } : undefined });
      setElapsed(0);
      setShowWin(false);
      updateStats(recordStart(stats, difficulty ?? state.settings.difficulty));
    },
    [dispatch, stats, state.settings.difficulty, updateStats],
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
  const selectedLocked = state.selected !== null && isLocked(state, state.selected);
  const activePhantoms = state.phantoms.filter((ph) => ph !== null).length;
  const phantomJustSpawned =
    state.lastPhantom !== null && state.lastPhantom.createdAtMove === state.moves && activePhantoms > 0;
  const difficultyLabel =
    state.settings.difficulty[0].toUpperCase() + state.settings.difficulty.slice(1);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Sudokuoku</Text>
          <Text style={styles.subtitle}>{difficultyLabel} · shifting board</Text>
        </View>
        <View style={styles.headerButtons}>
          <HeaderButton label="?" a11y="How to play" onPress={() => setShowHelp(true)} />
          <HeaderButton label="▤" a11y="Statistics" onPress={() => setShowStats(true)} />
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

      {state.settings.phantomMode ? (
        <View style={styles.phantomLine}>
          <Text style={styles.phantomText} numberOfLines={1}>
            {phantomJustSpawned
              ? `◌ A ${state.lastPhantom!.wasGiven ? 'given' : 'digit'} is fading. Locked for ${state.settings.phantomLockMoves} moves.`
              : selectedLocked
                ? '◌ This cell is locked. Remember what was here.'
                : activePhantoms > 0
                  ? `◌ ${activePhantoms} phantom${activePhantoms === 1 ? '' : 's'} on the board`
                  : '◌ Phantom challenge on'}
          </Text>
        </View>
      ) : null}

      <View
        style={styles.boardWrap}
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          setBoardArea((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
        }}
      >
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
          disabled={!playing || state.selected === null || selectedLocked}
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
      <HelpSheet visible={showHelp} onClose={closeHelp} />
      <StatsSheet
        visible={showStats}
        stats={stats}
        onClose={() => setShowStats(false)}
        onReset={() => {
          Alert.alert('Reset statistics?', 'This cannot be undone.', [
            { text: 'Keep', style: 'cancel' },
            {
              text: 'Reset',
              style: 'destructive',
              onPress: () => {
                clearStats();
                setStats(EMPTY_STATS);
              },
            },
          ]);
        }}
      />
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
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
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
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
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
  phantomLine: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.cellPhantom,
  },
  phantomText: {
    color: colors.phantom,
    fontSize: 13,
    fontWeight: '600',
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
