import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Board from '../components/Board';
import Controls from '../components/Controls';
import DailySheet from '../components/DailySheet';
import HelpSheet from '../components/HelpSheet';
import NumberPad from '../components/NumberPad';
import ProgressSheet from '../components/ProgressSheet';
import SettingsSheet from '../components/SettingsSheet';
import ShiftBanner from '../components/ShiftBanner';
import WinSheet from '../components/WinSheet';
import {
  Action,
  DEFAULT_SETTINGS,
  Difficulty,
  GameState,
  Profile,
  Settings,
  WinOutcome,
  currentStreak,
  dailyConfig,
  dailySeed,
  dailySettings,
  dateKey,
  emptyProfile,
  isLocked,
  newGame,
  recordGameStart,
  recordGameWin,
  reduce,
  remainingCounts,
  shareText,
} from '../engine';
import {
  clearDailyGame,
  clearProfile,
  hasSeenHelp,
  loadDailyGame,
  loadGame,
  loadProfile,
  markHelpSeen,
  saveDailyGame,
  saveGame,
  saveProfile,
} from '../storage';
import { Colors, ThemeProvider, radius, useStyles, useTheme } from '../theme';
import { formatTime } from '../utils/time';

interface Loaded {
  free: GameState;
  daily: GameState | null;
  profile: Profile;
  firstLaunch: boolean;
}

/** Settings that follow the player across free and daily games. */
const SHARED_SETTING_KEYS: (keyof Settings)[] = [
  'highlightConflicts',
  'showMistakes',
  'animateShifts',
  'theme',
  'themePack',
  'reduceMotion',
  'phantomMarkers',
  'phantomFadeMs',
];

function pickShared(settings: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of SHARED_SETTING_KEYS) (out as Record<string, unknown>)[k] = settings[k];
  return out;
}

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
    Promise.all([loadGame(), loadDailyGame(), loadProfile(), hasSeenHelp()]).then(
      ([savedFree, savedDaily, loadedProfile, seenHelp]) => {
        if (cancelled) return;
        let profile = loadedProfile;
        let free: GameState;
        if (savedFree && savedFree.status === 'playing') {
          free = savedFree;
        } else {
          const settings = { ...DEFAULT_SETTINGS, ...(savedFree?.settings ?? {}) };
          free = newGame(settings);
          profile = recordGameStart(profile, free.settings.difficulty);
          saveProfile(profile);
        }
        // A daily from another day, or one already finished, is discarded.
        const today = dateKey(new Date());
        let daily: GameState | null = null;
        if (savedDaily && savedDaily.dailyKey === today && savedDaily.status === 'playing') {
          daily = savedDaily;
        } else if (savedDaily) {
          clearDailyGame();
        }
        setLoaded({ free, daily, profile, firstLaunch: !seenHelp });
      },
    );
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
  const [state, dispatch] = useReducer(reduce, initial.free);
  return (
    <ThemeProvider preference={state.settings.theme} pack={state.settings.themePack}>
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
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [profile, setProfile] = useState<Profile>(initial.profile);
  const [outcome, setOutcome] = useState<WinOutcome | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(initial.firstLaunch);
  const [showWin, setShowWin] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [showDaily, setShowDaily] = useState(false);

  /** The game that is not on screen (daily while free is shown, and vice versa). */
  const parked = useRef<GameState | null>(initial.daily);

  const todayKey = dateKey(new Date());
  const config = dailyConfig(todayKey);
  const isDaily = state.mode === 'daily';
  const dailyDone = !!profile.daily[todayKey];
  const dailyInProgress = isDaily
    ? state.status === 'playing'
    : parked.current !== null && parked.current.dailyKey === todayKey && parked.current.status === 'playing';

  const updateProfile = useCallback((next: Profile) => {
    setProfile(next);
    saveProfile(next);
  }, []);

  // The board fills whatever space is left between the banner and the pad.
  const [boardArea, setBoardArea] = useState({ w: width - 24, h: height * 0.5 });
  const boardSize = Math.max(200, Math.floor(Math.min(boardArea.w, boardArea.h) - 4));

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
      if (appActive.current) dispatch({ type: 'tick' });
    }, 1000);
    return () => clearInterval(id);
  }, [state.status, dispatch]);

  // Persist on every board change, and every 10 seconds for the timer.
  const persist = useCallback((s: GameState) => {
    if (s.mode === 'daily') {
      if (s.status === 'playing') saveDailyGame(s);
    } else {
      saveGame(s);
    }
  }, []);
  useEffect(() => {
    persist(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.version, state.seed, state.settings, state.status, state.mode]);
  useEffect(() => {
    if (state.elapsed > 0 && state.elapsed % 10 === 0) persist(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.elapsed]);

  // Feedback when a shift lands.
  const lastShiftCount = useRef(state.shiftCount);
  useEffect(() => {
    if (state.shiftCount > lastShiftCount.current) haptic('shift');
    lastShiftCount.current = state.shiftCount;
  }, [state.shiftCount]);

  // A win: fold it into the profile once per game.
  const wonSeed = useRef<number | null>(initial.free.status === 'won' ? initial.free.seed : null);
  useEffect(() => {
    if (state.status !== 'won' || wonSeed.current === state.seed) return;
    wonSeed.current = state.seed;
    haptic('win');
    const result = recordGameWin(profile, state, new Date());
    updateProfile(result.profile);
    setOutcome(result);
    setShowWin(true);
    if (state.mode === 'daily') clearDailyGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.seed]);

  const send = useCallback((action: Action) => dispatch(action), [dispatch]);

  /** Swaps the on-screen game with the parked one, creating a daily if needed. */
  const switchTo = useCallback(
    (mode: 'free' | 'daily'): void => {
      if (state.mode === mode) return;
      let next = parked.current;
      // Park the current game (a finished daily is not worth keeping).
      if (state.mode === 'daily' && state.status !== 'playing') {
        parked.current = null;
        clearDailyGame();
      } else {
        persist(state);
        parked.current = state;
      }
      const shared = pickShared(state.settings);
      if (mode === 'daily') {
        if (!next || next.dailyKey !== todayKey) {
          const settings = dailySettings({ ...state.settings, ...shared }, config);
          next = newGame(settings, dailySeed(todayKey), { mode: 'daily', dailyKey: todayKey });
          updateProfile(recordGameStart(profile, settings.difficulty));
        } else {
          next = { ...next, settings: { ...next.settings, ...shared } };
        }
      } else {
        if (!next) {
          next = newGame({ ...state.settings, ...shared, ...pickFreeRules(initial.free.settings) });
          updateProfile(recordGameStart(profile, next.settings.difficulty));
        } else {
          next = { ...next, settings: { ...next.settings, ...shared } };
        }
      }
      wonSeed.current = next.status === 'won' ? next.seed : null;
      setShowWin(false);
      setOutcome(null);
      dispatch({ type: 'load', state: next });
    },
    [state, todayKey, config, profile, persist, updateProfile, dispatch, initial.free.settings],
  );

  const startNewGame = useCallback(
    (difficulty?: Difficulty) => {
      const base = state.mode === 'daily' ? parked.current?.settings ?? initial.free.settings : state.settings;
      const settings: Settings = {
        ...base,
        ...pickShared(state.settings),
        difficulty: difficulty ?? base.difficulty,
      };
      if (state.mode === 'daily') {
        if (state.status !== 'playing') clearDailyGame();
        else {
          persist(state);
        }
        parked.current = state.status === 'playing' ? state : null;
      }
      const next = newGame(settings);
      wonSeed.current = null;
      setShowWin(false);
      setOutcome(null);
      updateProfile(recordGameStart(profile, settings.difficulty));
      dispatch({ type: 'load', state: next });
    },
    [state, profile, persist, updateProfile, dispatch, initial.free.settings],
  );

  const confirmNewGame = () => {
    const freeGame = state.mode === 'free' ? state : parked.current;
    const inProgress = freeGame && freeGame.mode === 'free' && freeGame.status === 'playing' && freeGame.moves > 0;
    if (!inProgress) {
      startNewGame();
      return;
    }
    Alert.alert('Start a new free game?', 'Your current free game will be lost.', [
      { text: 'Keep playing', style: 'cancel' },
      { text: 'New game', style: 'destructive', onPress: () => startNewGame() },
    ]);
  };

  const shareDaily = async () => {
    const result = profile.daily[todayKey];
    if (!result) return;
    await shareMessage(shareText(result, currentStreak(profile.daily, todayKey)));
  };

  const closeHelp = () => {
    setShowHelp(false);
    markHelpSeen();
  };

  const playing = state.status === 'playing';
  const remaining = remainingCounts(state);
  const selectedLocked = state.selected !== null && isLocked(state, state.selected);
  const activePhantoms = state.phantoms.filter((ph) => ph !== null && !ph.unlocked).length;
  const phantomJustSpawned =
    state.lastPhantom !== null && state.lastPhantom.createdAtMove === state.moves && activePhantoms > 0;
  const difficultyLabel =
    state.settings.difficulty[0].toUpperCase() + state.settings.difficulty.slice(1);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Sudokuoku</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {isDaily ? `Daily · ${config.label}` : `${difficultyLabel} · shifting board`}
          </Text>
        </View>
        <View style={styles.headerButtons}>
          <HeaderButton label="📅" a11y="Daily challenge" dot={!dailyDone} onPress={() => setShowDaily(true)} />
          <HeaderButton label="🏆" a11y="Progress" onPress={() => setShowProgress(true)} />
          <HeaderButton label="⚙" a11y="Settings" onPress={() => setShowSettings(true)} />
          <HeaderButton label="＋" a11y="New game" onPress={confirmNewGame} />
        </View>
      </View>

      <View style={styles.statsRow}>
        <Stat label="Time" value={formatTime(state.elapsed)} />
        <Stat label="Moves" value={String(state.moves)} />
        <Stat label="Shifts" value={String(state.shiftCount)} />
        <Stat label="Left" value={String(state.values.filter((v) => v === 0).length)} />
      </View>

      <ShiftBanner
        shift={state.lastShift}
        shiftCount={state.shiftCount}
        moves={state.moves}
        reduceMotion={state.settings.reduceMotion}
      />

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
        daily={isDaily}
        onClose={() => setShowSettings(false)}
        onChange={(patch) => send({ type: 'updateSettings', settings: patch })}
        onNewGame={(difficulty) => startNewGame(difficulty)}
        onHelp={() => setShowHelp(true)}
      />
      <HelpSheet visible={showHelp} onClose={closeHelp} />
      <DailySheet
        visible={showDaily}
        todayKey={todayKey}
        config={config}
        profile={profile}
        inProgress={dailyInProgress}
        active={isDaily}
        onClose={() => setShowDaily(false)}
        onPlay={() => switchTo('daily')}
        onShare={(text) => shareMessage(text)}
      />
      <ProgressSheet
        visible={showProgress}
        profile={profile}
        todayKey={todayKey}
        onClose={() => setShowProgress(false)}
        onReset={() => {
          Alert.alert('Reset progress?', 'Statistics, XP, badges and daily history will be erased. This cannot be undone.', [
            { text: 'Keep', style: 'cancel' },
            {
              text: 'Reset',
              style: 'destructive',
              onPress: () => {
                clearProfile();
                setProfile(emptyProfile());
              },
            },
          ]);
        }}
      />
      <WinSheet
        visible={showWin}
        state={state}
        outcome={outcome}
        onClose={() => setShowWin(false)}
        onNewGame={() => startNewGame()}
        onShare={isDaily ? shareDaily : undefined}
      />
    </View>
  );
}

/** Rule settings that belong to free play only. */
function pickFreeRules(settings: Settings): Partial<Settings> {
  return {
    difficulty: settings.difficulty,
    enabledShifts: settings.enabledShifts,
    shiftEvery: settings.shiftEvery,
    phantomMode: settings.phantomMode,
    phantomTarget: settings.phantomTarget,
    phantomEvery: settings.phantomEvery,
    phantomLockMoves: settings.phantomLockMoves,
    phantomMax: settings.phantomMax,
  };
}

async function shareMessage(message: string): Promise<void> {
  try {
    await Share.share({ message });
  } catch {
    Alert.alert('Your result', message);
  }
}

function HeaderButton({
  label,
  a11y,
  dot,
  onPress,
}: {
  label: string;
  a11y: string;
  dot?: boolean;
  onPress: () => void;
}) {
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
      {dot ? <View style={styles.dot} /> : null}
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
    dot: {
      position: 'absolute',
      top: 2,
      right: 2,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: colors.danger,
      borderWidth: 1.5,
      borderColor: colors.surface,
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
