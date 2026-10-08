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
  receiveChallenge,
  startChallenge,
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
  clearChallengeGame,
  clearDailyGame,
  clearProfile,
  loadChallengeCode,
  loadChallengeGame,
  loadDailyGame,
  loadGame,
  loadProfile,
  loadSharedSettings,
  saveChallengeCode,
  saveChallengeGame,
  saveDailyGame,
  saveGame,
  saveProfile,
  saveSharedSettings,
} from '../storage';
import { confirmAction, notify } from '../confirm';
import { haptic, setHapticsEnabled } from '../haptics';
import { useReduceMotion } from '../motion';
import { Colors, ThemeProvider, radius, useStyles, useTheme } from '../theme';
import { CHALLENGE_LINK, withoutChallengeLink } from '../utils/challengeInput';
import { describeShift } from '../utils/describe';
import { applyShared, pickShared } from '../utils/saved';
import { formatTime } from '../utils/time';

interface Loaded {
  free: GameState;
  daily: GameState | null;
  challenge: GameState | null;
  challengeInfo: Challenge | null;
  profile: Profile;
  /**
   * Whether the introduction has been read; it opens by itself until it has.
   * Null when the store could not be read: it stays closed for this launch,
   * and nothing about it is written until the player closes it.
   */
  seenIntro: boolean | null;
}

export default function GameScreen() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadGame(),
      loadDailyGame(),
      loadProfile(),
      loadSharedSettings(),
      loadChallengeGame(),
      loadChallengeCode(),
    ]).then(
      ([savedFree, savedDaily, loadedProfile, shared, savedChallenge, challengeCode]) => {
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
        // Appearance and assistance are the player's, not the game's: they
        // are stored on their own and overlaid on whichever game is restored.
        free = { ...free, settings: applyShared(free.settings, shared.settings) };
        if (daily) daily = { ...daily, settings: applyShared(daily.settings, shared.settings) };
        if (challenge) challenge = { ...challenge, settings: applyShared(challenge.settings, shared.settings) };
        setLoaded({ free, daily, challenge, challengeInfo, profile, seenIntro: shared.seenIntro });
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
  const [showHelp, setShowHelp] = useState(initial.seenIntro === false);
  const [seenIntro, setSeenIntro] = useState<boolean | null>(initial.seenIntro);
  const [showWin, setShowWin] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [showDaily, setShowDaily] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);

  const MAX_CODE_LENGTH = 16384;

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
  // Mode alone does not say whether the board on screen is *today's* daily:
  // the app can sit open across local midnight. Everything the daily card and
  // its button say has to be answered for today, not for the mode.
  const onTodaysDaily = isTodaysDaily(state, todayKey);
  const dailyDone = !!profile.daily[todayKey];
  const dailyInProgress = todaysDailyInProgress(state, parked.current.daily ?? null, todayKey);

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
  // The shared settings are kept outside both games, so a change made while
  // the daily is on screen still survives a restart and a switch. The intro
  // flag travels in the same record, so it is written from here as well —
  // once it is known; an unknown one leaves the record's own flag in place.
  useEffect(() => {
    saveSharedSettings({ settings: pickShared(state.settings), seenIntro });
  }, [state.settings, seenIntro]);

  // The preference is three-way; what the animations need is a yes or no,
  // and 'system' means following the device's own answer as it changes.
  const reduceMotion = useReduceMotion(state.settings.reduceMotion);

  // Haptics are gated by a module flag so every call site stays a one-liner.
  // Declared before the effects that fire one, so the flag is right first.
  useEffect(() => {
    setHapticsEnabled(state.settings.haptics);
  }, [state.settings.haptics]);

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

  /**
   * On the web, the challenge the page's address named when it loaded, as its code. The browser
   * keeps a followed link in the address bar and a reload reads it again, which is how a reload
   * carries on with that challenge. Once it is won, or another challenge takes the slot, the
   * link is taken out of the address: left there, the next reload started the challenge just
   * won over again and counted another game played.
   */
  const addressChallenge = useRef<string | null>(null);
  const forgetAddressChallenge = useCallback(() => {
    if (addressChallenge.current === null) return;
    addressChallenge.current = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.history.replaceState(window.history.state, '', withoutChallengeLink(window.location.href));
    }
  }, []);

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
    if (state.mode === 'challenge') {
      clearChallengeGame();
      forgetAddressChallenge();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.seed]);

  const send = useCallback((action: Action) => dispatch(action), [dispatch]);

  /**
   * Stores the on-screen game so it can be returned to. A finished daily or
   * challenge is discarded instead, and so is a daily whose day has gone:
   * none of them can be played on.
   */
  const park = useCallback(
    (s: GameState) => {
      if (s.mode !== 'free' && (s.status !== 'playing' || isDailyStale(s, todayKey))) {
        delete parked.current[s.mode];
        if (s.mode === 'daily') clearDailyGame();
        else clearChallengeGame();
        return;
      }
      persist(s);
      parked.current[s.mode] = s;
    },
    [persist, todayKey],
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
      // Midnight can pass with the app open, and then "play today's daily"
      // while yesterday's is on screen is a real switch, not a no-op.
      if (state.mode === mode && !isDailyStale(state, todayKey)) return;
      const waiting = state.mode === mode ? undefined : parked.current[mode];
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
      const code = encodeChallenge(challenge);
      setChallengeInfo(challenge);
      saveChallengeCode(code);
      if (code !== addressChallenge.current) forgetAddressChallenge();
      updateProfile(recordGameStart(profile, next.settings.difficulty));
      show(next);
    },
    [state, profile, park, show, updateProfile, setChallengeInfo, forgetAddressChallenge],
  );

  /**
   * A challenge from a link, which whoever wrote it can make the app follow.
   * There is one challenge slot, so the one already being played is resumed
   * rather than started over, and a different one replaces a challenge with
   * moves in it only once the player says so (see receiveChallenge). The
   * sheet's Play this board is the player's own choice and starts its board.
   */
  const offerChallenge = useCallback(
    (challenge: Challenge) => {
      const current = state.mode === 'challenge' ? state : parked.current.challenge;
      switch (receiveChallenge(current, challengeInfo, challenge)) {
        case 'resume':
          switchTo('challenge');
          return;
        case 'ask':
          confirmAction({
            title: 'Start a new challenge?',
            message: 'The challenge you are playing will be lost.',
            cancelLabel: 'Keep playing',
            confirmLabel: 'New challenge',
            onConfirm: () => openChallenge(challenge),
          });
          return;
        case 'start':
          openChallenge(challenge);
      }
    },
    [state, challengeInfo, switchTo, openChallenge],
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
    setSeenIntro(true);
  };

  // A tapped challenge link, whether it cold-started the app or arrived while
  // it was already open: sudokuoku://c/<code>, the link challengeLink writes.
  const offerChallengeRef = useRef(offerChallenge);
  offerChallengeRef.current = offerChallenge;

  const getChallengeCode = (url: string): string | null => {
    const match = CHALLENGE_LINK.exec(url);
    if (!match) return null;
    const rawCode = match[1];
    if (!rawCode || rawCode.length > MAX_CODE_LENGTH) return null;
    try {
      const decoded = decodeURIComponent(rawCode);
      return decoded.length <= MAX_CODE_LENGTH ? decoded : null;
    } catch {
      return rawCode.length <= MAX_CODE_LENGTH ? rawCode : null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const handle = (url: string | null) => {
      if (!url || cancelled) return;
      const code = getChallengeCode(url);
      if (!code) return;
      const result = decodeChallenge(code);
      if (result.ok) {
        if (Platform.OS === 'web') addressChallenge.current = encodeChallenge(result.challenge);
        offerChallengeRef.current(result.challenge);
      } else {
        notify('That challenge could not be opened', result.error);
      }
    };

    Linking.getInitialURL().then(handle);
    // In a browser a link from elsewhere loads the page, and the address is
    // read above. The 'url' event there is every message posted to the window,
    // from any origin, reported with the page's own unchanged address, so all
    // it could do is open that address again: one postMessage from an opener,
    // a frame or an extension restarted a challenge the page was opened with,
    // moves and all.
    const sub = Platform.OS === 'web' ? null : Linking.addEventListener('url', (event) => handle(event.url));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  const playing = state.status === 'playing';
  const remaining = remainingCounts(state);
  const selectedLocked = state.selected !== null && isLocked(state, state.selected);
  const activePhantoms = state.phantoms.filter((ph) => ph !== null && !ph.unlocked).length;
  const phantomJustSpawned =
    state.lastPhantom !== null && state.lastPhantom.createdAtMove === state.moves && activePhantoms > 0;
  const difficultyLabel =
    state.settings.difficulty.charAt(0).toUpperCase() + state.settings.difficulty.slice(1);

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
            active={onTodaysDaily}
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
        reduceMotion={reduceMotion}
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
          reduceMotion={reduceMotion}
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
      <HelpSheet visible={showHelp} reduceMotion={reduceMotion} onClose={closeHelp} />
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
        onChallenge={isDaily ? undefined : () => setShowChallenge(true)}
        ghost={isChallenge ? challengeInfo?.ghost ?? null : null}
        reduceMotion={reduceMotion}
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
