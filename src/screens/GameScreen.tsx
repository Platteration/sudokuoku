import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo,
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
import IconButton from '../components/ui/IconButton';
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
  dailyConfig,
  dailySeed,
  dailySettings,
  dateKey,
  emptyProfile,
  isDailyStale,
  isLocked,
  isTodaysDaily,
  newGame,
  nextShifts,
  profileStreak,
  recordGameStart,
  recordGameWin,
  refreshStreak,
  reduce,
  remainingCounts,
  shareText,
  todaysDailyInProgress,
} from '../engine';
import {
  clearDailyGame,
  clearProfile,
  hasSeenHelp,
  loadDailyGame,
  loadGame,
  loadProfile,
  loadSharedSettings,
  markHelpSeen,
  saveDailyGame,
  saveGame,
  saveProfile,
  saveSharedSettings,
} from '../storage';
import { Colors, ThemeProvider, radius, useStyles, useTheme } from '../theme';
import { describeShift } from '../utils/describe';
import { applyShared, pickShared } from '../utils/saved';
import { formatTime } from '../utils/time';

interface Loaded {
  free: GameState;
  daily: GameState | null;
  profile: Profile;
  firstLaunch: boolean;
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
    Promise.all([
      loadGame(),
      loadDailyGame(),
      loadProfile(),
      hasSeenHelp(),
      loadSharedSettings(),
    ]).then(
      ([savedFree, savedDaily, loadedProfile, seenHelp, shared]) => {
        if (cancelled) return;
        // Grant the monthly freeze and spend one if a missed day can be saved.
        let profile = refreshStreak(loadedProfile, dateKey(new Date()));
        if (profile !== loadedProfile) saveProfile(profile);
        let free: GameState;
        // Only the daily slot is tested for staleness below, so the free slot
        // must not be able to hold a daily: readSavedGame takes the kind of
        // game from the slot it was read out of rather than from the save.
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
        if (savedDaily && !isDailyStale(savedDaily, today) && savedDaily.status === 'playing') {
          daily = savedDaily;
        } else if (savedDaily) {
          clearDailyGame();
        }
        // Appearance and assistance are the player's, not the game's: they
        // are stored on their own and overlaid on whichever game is restored.
        free = { ...free, settings: applyShared(free.settings, shared) };
        if (daily) daily = { ...daily, settings: applyShared(daily.settings, shared) };
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
  // Mode alone does not say whether the board on screen is *today's* daily:
  // the app can sit open across local midnight. Everything the daily card and
  // its button say has to be answered for today, not for the mode.
  const onTodaysDaily = isTodaysDaily(state, todayKey);
  const dailyDone = !!profile.daily[todayKey];
  const dailyInProgress = todaysDailyInProgress(state, parked.current, todayKey);

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
  // The shared settings are kept outside both games, so a change made while
  // the daily is on screen still survives a restart and a switch.
  useEffect(() => {
    saveSharedSettings(pickShared(state.settings));
  }, [state.settings]);

  // Feedback when a shift lands. The board rearranging is invisible to a
  // screen reader, so it is spoken as well as felt.
  const lastShiftCount = useRef(state.shiftCount);
  useEffect(() => {
    if (state.shiftCount > lastShiftCount.current) {
      haptic('shift');
      if (state.lastShift) {
        AccessibilityInfo.announceForAccessibility(
          describeShift(state.lastShift.description, state.selected),
        );
      }
    }
    lastShiftCount.current = state.shiftCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.shiftCount]);

  // A digit fading away is likewise silent without this.
  const lastPhantomCount = useRef(state.phantomCount);
  useEffect(() => {
    if (state.phantomCount > lastPhantomCount.current && state.lastPhantom) {
      const ph = state.lastPhantom;
      AccessibilityInfo.announceForAccessibility(
        `A ${ph.wasGiven ? 'given' : 'digit'} faded away. That cell is locked for ${
          ph.unlockAtMove - ph.createdAtMove
        } moves.`,
      );
    }
    lastPhantomCount.current = state.phantomCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phantomCount]);

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
      // Midnight can pass with the app open, and then "play today's daily"
      // while yesterday's is on screen is a real switch, not a no-op.
      const stale = isDailyStale(state, todayKey);
      if (state.mode === mode && !stale) return;
      let next = parked.current;
      // Park the current game. A finished daily, and one whose day has gone,
      // are not worth keeping; the other game stays parked either way.
      if (state.mode === 'daily' && (state.status !== 'playing' || stale)) {
        if (mode !== 'daily') parked.current = null;
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
    confirmAction({
      title: 'Start a new free game?',
      message: 'Your current free game will be lost.',
      cancelLabel: 'Keep playing',
      confirmLabel: 'New game',
      onConfirm: () => startNewGame(),
    });
  };

  const shareDaily = async () => {
    const result = profile.daily[todayKey];
    if (!result) return;
    await shareMessage(shareText(result, profileStreak(profile, todayKey)));
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
          <IconButton
            name="daily"
            label="Daily challenge"
            badge={!dailyDone}
            active={onTodaysDaily}
            onPress={() => setShowDaily(true)}
          />
          <IconButton name="progress" label="Progress" onPress={() => setShowProgress(true)} />
          <IconButton name="settings" label="Settings" onPress={() => setShowSettings(true)} />
          <IconButton name="add" label="New game" onPress={confirmNewGame} />
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
        next={state.settings.shiftPreview === 'off' ? [] : nextShifts(state)}
        preview={state.settings.shiftPreview}
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
          disabled={!playing || selectedLocked}
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
      <HelpSheet visible={showHelp} reduceMotion={state.settings.reduceMotion} onClose={closeHelp} />
      <DailySheet
        visible={showDaily}
        todayKey={todayKey}
        config={config}
        profile={profile}
        inProgress={dailyInProgress}
        active={onTodaysDaily}
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
          confirmAction({
            title: 'Reset progress?',
            message:
              'Statistics, XP, badges and daily history will be erased. This cannot be undone.',
            cancelLabel: 'Keep',
            confirmLabel: 'Reset',
            onConfirm: () => {
              clearProfile();
              setProfile(emptyProfile());
            },
          });
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
    shiftsPerMove: settings.shiftsPerMove,
    phantomMode: settings.phantomMode,
    phantomTarget: settings.phantomTarget,
    phantomEvery: settings.phantomEvery,
    phantomLockMoves: settings.phantomLockMoves,
    phantomMax: settings.phantomMax,
  };
}

/**
 * react-native-web implements Alert as an empty stub, so a confirmation there
 * does nothing at all and the button it guards looks broken. The browser's own
 * dialog stands in on that platform.
 */
function confirmAction({
  title,
  message,
  cancelLabel,
  confirmLabel,
  onConfirm,
}: {
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
}): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

async function shareMessage(message: string): Promise<void> {
  try {
    await Share.share({ message });
  } catch {
    // Sharing rejects in every browser without navigator.share, which is where
    // the Alert fallback would be a no-op as well.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.alert(message);
      return;
    }
    Alert.alert('Your result', message);
  }
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
      paddingVertical: 7,
      marginHorizontal: 2.5,
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
