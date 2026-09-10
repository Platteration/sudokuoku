import AsyncStorage from '@react-native-async-storage/async-storage';
import { CELLS, DEFAULT_SETTINGS, GameState, Profile, normalizeProfile } from './engine';

const FREE_GAME_KEY = 'sudokuoku:game:v1';
const DAILY_GAME_KEY = 'sudokuoku:daily:v1';
const CHALLENGE_GAME_KEY = 'sudokuoku:challenge:v1';
const CHALLENGE_CODE_KEY = 'sudokuoku:challengeCode:v1';
const PROFILE_KEY = 'sudokuoku:profile:v1';
const LEGACY_STATS_KEY = 'sudokuoku:stats:v1';
const HELP_SEEN_KEY = 'sudokuoku:helpSeen:v1';

function looksLikeState(x: unknown): x is GameState {
  if (!x || typeof x !== 'object') return false;
  const s = x as Partial<GameState>;
  return (
    Array.isArray(s.values) &&
    s.values.length === CELLS &&
    Array.isArray(s.solution) &&
    Array.isArray(s.tokens) &&
    Array.isArray(s.given) &&
    typeof s.settings === 'object' &&
    s.settings !== null
  );
}

/** Fills in fields that older saves may lack. */
function normalize(state: GameState, legacyElapsed?: number): GameState {
  return {
    ...state,
    settings: { ...DEFAULT_SETTINGS, ...state.settings },
    mode: state.mode === 'daily' || state.mode === 'challenge' ? state.mode : 'free',
    dailyKey: typeof state.dailyKey === 'string' ? state.dailyKey : null,
    elapsed:
      typeof state.elapsed === 'number'
        ? state.elapsed
        : typeof legacyElapsed === 'number'
          ? legacyElapsed
          : 0,
    phantoms:
      Array.isArray(state.phantoms) && state.phantoms.length === CELLS
        ? state.phantoms
        : new Array(CELLS).fill(null),
    lastPhantom: state.lastPhantom ?? null,
    phantomCount: typeof state.phantomCount === 'number' ? state.phantomCount : 0,
    phantomsRecalled: typeof state.phantomsRecalled === 'number' ? state.phantomsRecalled : 0,
    phantomsMissed: typeof state.phantomsMissed === 'number' ? state.phantomsMissed : 0,
    log: Array.isArray(state.log) ? state.log : [],
    history: Array.isArray(state.history) ? state.history : [],
  };
}

async function loadState(key: string): Promise<GameState | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: unknown; elapsed?: number };
    // Older saves wrapped the state as { state, elapsed }.
    const candidate = looksLikeState(parsed) ? parsed : parsed.state;
    if (!looksLikeState(candidate)) return null;
    return normalize(candidate, parsed.elapsed);
  } catch {
    return null;
  }
}

async function saveState(key: string, state: GameState): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Persisting is best-effort; the game keeps working without it.
  }
}

export const loadGame = () => loadState(FREE_GAME_KEY);
export const saveGame = (state: GameState) => saveState(FREE_GAME_KEY, state);
export const loadDailyGame = () => loadState(DAILY_GAME_KEY);
export const saveDailyGame = (state: GameState) => saveState(DAILY_GAME_KEY, state);
export const loadChallengeGame = () => loadState(CHALLENGE_GAME_KEY);
export const saveChallengeGame = (state: GameState) => saveState(CHALLENGE_GAME_KEY, state);

export async function clearChallengeGame(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([CHALLENGE_GAME_KEY, CHALLENGE_CODE_KEY]);
  } catch {
    // best-effort
  }
}

/**
 * The code a challenge in progress came from, kept beside the board so the
 * opponent's ghost survives an app restart.
 */
export async function saveChallengeCode(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CHALLENGE_CODE_KEY, code);
  } catch {
    // best-effort
  }
}

export async function loadChallengeCode(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CHALLENGE_CODE_KEY);
  } catch {
    return null;
  }
}

export async function clearDailyGame(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DAILY_GAME_KEY);
  } catch {
    // best-effort
  }
}

export async function loadProfile(): Promise<Profile> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (raw) return normalizeProfile(JSON.parse(raw));
    // One-time migration from the older stats-only store.
    const legacy = await AsyncStorage.getItem(LEGACY_STATS_KEY);
    if (legacy) {
      const profile = normalizeProfile({ stats: JSON.parse(legacy) });
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      await AsyncStorage.removeItem(LEGACY_STATS_KEY);
      return profile;
    }
    return normalizeProfile(null);
  } catch {
    return normalizeProfile(null);
  }
}

export async function saveProfile(profile: Profile): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // best-effort
  }
}

export async function clearProfile(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PROFILE_KEY);
  } catch {
    // best-effort
  }
}

export async function hasSeenHelp(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HELP_SEEN_KEY)) === '1';
  } catch {
    return true; // if storage is unavailable, do not nag on every launch
  }
}

export async function markHelpSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(HELP_SEEN_KEY, '1');
  } catch {
    // best-effort
  }
}
