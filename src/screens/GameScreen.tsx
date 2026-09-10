import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
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
import ChallengeSheet from '../components/ChallengeSheet';
import ProgressSheet from '../components/ProgressSheet';
import SettingsSheet from '../components/SettingsSheet';
import ShiftBanner from '../components/ShiftBanner';
import WinSheet from '../components/WinSheet';
import {
  Action,
  Challenge,
  DEFAULT_SETTINGS,
  Difficulty,
  GameMode,
  GameState,
  decodeChallenge,
  encodeChallenge,
  startChallenge,
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
  nextShift,
  recordGameStart,
  recordGameWin,
  refreshStreak,
  reduce,
  remainingCounts,
  shareText,
} from '../engine';
import {
  clearChallengeGame,
  clearDailyGame,
  clearProfile,
  hasSeenHelp,
  loadChallengeCode,
  loadChallengeGame,
  loadDailyGame,
  loadGame,
  loadProfile,
  markHelpSeen,
  saveChallengeCode,
  saveChallengeGame,
  saveDailyGame,
  saveGame,
  saveProfile,
} from '../storage';
import { Colors, ThemeProvider, radius, useStyles, useTheme } from '../theme';
import { describeShift } from '../utils/describe';
import { formatTime } from '../utils/time';

interface Loaded {
  free: GameState;
  daily: GameState | null;
  challenge: GameState | null;
  challengeInfo: Challenge | null;
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
  'shiftPreview',
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
    Promise.all([
      loadGame(),
      loadDailyGame(),
      loadProfile(),
      hasSeenHelp(),
      loadChallengeGame(),
      loadChallengeCode(),
    ]).then(
      ([savedFree, savedDaily, loadedProfile, seenHelp, savedChallenge, challengeCode]) => {
        if (cancelled) return;
        // Grant the monthly freeze and spend one if a missed day can be saved.
        let profile = refreshStreak(loadedProfile, dateKey(new Date()));
        if (profile !== loadedProfile) saveProfile(profile);
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
        // An unfinished challenge is resumed, along with the code it came
        // from so the opponent's ghost is still there.
        let challenge: GameState | null = null;
        let challengeInfo: Challenge | null = null;
        if (savedChallenge && savedChallenge.status === 'playing') {
          challenge = savedChallenge;
          const decoded = challengeCode ? decodeChallenge(challengeCode) : null;
          if (decoded && decoded.ok) challengeInfo = decoded.challenge;
        } else if (savedChallenge) {
          clearChallengeGame();
        }
        setLoaded({ free, daily, challenge, challengeInfo, profile, firstLaunch: !seenHelp });
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
  const [showChallenge, setShowChallenge] = useState(false);

  /** The games that are not on screen, one slot per mode. */
  const parked = useRef<Partial<Record<GameMode, GameState>>>({
    daily: initial.daily ?? undefined,
    challenge: initial.challenge ?? undefined,
  });
  const [challengeInfo, setChallengeInfo] = useState<Challenge | null>(initial.challengeInfo);

  const todayKey = dateKey(new Date());
  const config = dailyConfig(todayKey);
  const isDaily = state.mode === 'daily';
  const isChallenge = state.mode === 'challenge';
  const dailyDone = !!profile.daily[todayKey];
  const parkedDaily = parked.current.daily;
  const dailyInProgress = isDaily
    ? state.status === 'playing'
    : !!parkedDaily && parkedDaily.dailyKey === todayKey && parkedDaily.status === 'playing';

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
    // Only free play is worth saving once finished; a daily or a challenge is
    // a single attempt, so a completed one is cleared rather than stored.
    if (s.mode === 'daily') {
      if (s.status === 'playing') saveDailyGame(s);
    } else if (s.mode === 'challenge') {
      if (s.status === 'playing') saveChallengeGame(s);
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
    if (state.mode === 'challenge') clearChallengeGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.seed]);

  const send = useCallback((action: Action) => dispatch(action), [dispatch]);

  /**
   * Stores the on-screen game so it can be returned to. A finished daily or
   * challenge is discarded instead: neither can be replayed.
   */
  const park = useCallback(
    (s: GameState) => {
      if (s.mode !== 'free' && s.status !== 'playing') {
        delete parked.current[s.mode];
        if (s.mode === 'daily') clearDailyGame();
        else clearChallengeGame();
        return;
      }
      persist(s);
      parked.current[s.mode] = s;
    },
    [persist],
  );

  /** Puts a game on screen, clearing anything left over from the last one. */
  const show = useCallback(
    (next: GameState) => {
      wonSeed.current = next.status === 'won' ? next.seed : null;
      setShowWin(false);
      setOutcome(null);
      dispatch({ type: 'load', state: next });
    },
    [dispatch],
  );

  /** Swaps the on-screen game for the one parked under `mode`. */
  const switchTo = useCallback(
    (mode: GameMode): void => {
      if (state.mode === mode) return;
      const waiting = parked.current[mode];
      park(state);
      const shared = pickShared(state.settings);

      if (waiting && !(mode === 'daily' && waiting.dailyKey !== todayKey)) {
        show({ ...waiting, settings: { ...waiting.settings, ...shared } });
        return;
      }

      if (mode === 'daily') {
        const settings = dailySettings({ ...state.settings, ...shared }, config);
        const next = newGame(settings, dailySeed(todayKey), { mode: 'daily', dailyKey: todayKey });
        updateProfile(recordGameStart(profile, settings.difficulty));
        show(next);
        return;
      }
      if (mode === 'free') {
        const next = newGame({
          ...state.settings,
          ...shared,
          ...pickFreeRules(initial.free.settings),
        });
        updateProfile(recordGameStart(profile, next.settings.difficulty));
        show(next);
      }
      // 'challenge' with nothing parked has nothing to show; the sheet is the
      // only way in, and it always supplies a challenge.
    },
    [state, todayKey, config, profile, park, show, updateProfile, initial.free.settings],
  );

  /** Starts the board a challenge code describes. */
  const openChallenge = useCallback(
    (challenge: Challenge) => {
      park(state);
      const settings = { ...state.settings, ...pickShared(state.settings) };
      const next = startChallenge(settings, challenge);
      setChallengeInfo(challenge);
      saveChallengeCode(encodeChallenge(challenge));
      updateProfile(recordGameStart(profile, next.settings.difficulty));
      show(next);
    },
    [state, profile, park, show, updateProfile],
  );

  /** Always starts a fresh *free* game, parking whatever was on screen. */
  const startNewGame = useCallback(
    (difficulty?: Difficulty) => {
      const base =
        state.mode === 'free'
          ? state.settings
          : parked.current.free?.settings ?? initial.free.settings;
      const settings: Settings = {
        ...base,
        ...pickShared(state.settings),
        difficulty: difficulty ?? base.difficulty,
      };
      if (state.mode !== 'free') park(state);
      const next = newGame(settings);
      updateProfile(recordGameStart(profile, settings.difficulty));
      show(next);
    },
    [state, profile, park, show, updateProfile, initial.free.settings],
  );

  const confirmNewGame = () => {
    const freeGame = state.mode === 'free' ? state : parked.current.free;
    const inProgress = freeGame && freeGame.status === 'playing' && freeGame.moves > 0;
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
    await shareMessage(shareText(result, currentStreak(profile.daily, todayKey, profile.frozenDays)));
  };

  const closeHelp = () => {
    setShowHelp(false);
    markHelpSeen();
  };

  // A tapped challenge link, whether it cold-started the app or arrived while
  // it was already open. The code is the last path segment of either
  // sudokuoku://c/<code> or https://<host>/c/<code>.
  const openChallengeRef = useRef(openChallenge);
  openChallengeRef.current = openChallenge;
  useEffect(() => {
    let cancelled = false;

    const handle = (url: string | null) => {
      if (!url || cancelled) return;
      const marker = '/c/';
      const at = url.indexOf(marker);
      if (at < 0) return;
      const code = url.slice(at + marker.length).split(/[?#]/)[0];
      const result = decodeChallenge(code);
      if (result.ok) {
        openChallengeRef.current(result.challenge);
      } else {
        Alert.alert('That challenge could not be opened', result.error);
      }
    };

    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (event) => handle(event.url));
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

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
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            Sudokuoku
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {isDaily
              ? `Daily · ${config.label}`
              : isChallenge
                ? `Challenge · ${difficultyLabel}`
                : `${difficultyLabel} · shifting board`}
          </Text>
        </View>
        <View style={styles.headerButtons}>
          <IconButton
            name="daily"
            label="Daily challenge"
            badge={!dailyDone}
            active={isDaily}
            onPress={() => setShowDaily(true)}
          />
          <IconButton
            name="share"
            label="Challenge a friend"
            active={isChallenge}
            onPress={() => setShowChallenge(true)}
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
        next={state.settings.shiftPreview === 'off' ? null : nextShift(state)}
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
        active={isDaily}
        onClose={() => setShowDaily(false)}
        onPlay={() => switchTo('daily')}
        onShare={(text) => shareMessage(text)}
      />
      <ChallengeSheet
        visible={showChallenge}
        state={state}
        active={isChallenge ? challengeInfo : null}
        onClose={() => setShowChallenge(false)}
        onPlay={openChallenge}
        onShare={shareMessage}
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
        onChallenge={isDaily ? undefined : () => setShowChallenge(true)}
        ghost={isChallenge ? challengeInfo?.ghost ?? null : null}
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

async function shareMessage(message: string): Promise<void> {
  try {
    await Share.share({ message });
  } catch {
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
    headerText: {
      flex: 1,
      minWidth: 96,
      marginRight: 4,
    },
    headerButtons: {
      flexDirection: 'row',
      flexShrink: 0,
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
