import AsyncStorage from '@react-native-async-storage/async-storage';
import { CELLS, DEFAULT_SETTINGS, GameState, Settings } from './engine';

const GAME_KEY = 'sudokuoku:game:v1';
const HELP_SEEN_KEY = 'sudokuoku:helpSeen:v1';

export interface SavedGame {
  state: GameState;
  elapsed: number;
}

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
function normalize(state: GameState): GameState {
  return {
    ...state,
    settings: { ...DEFAULT_SETTINGS, ...state.settings },
    phantoms:
      Array.isArray(state.phantoms) && state.phantoms.length === CELLS
        ? state.phantoms
        : new Array(CELLS).fill(null),
    lastPhantom: state.lastPhantom ?? null,
    phantomCount: typeof state.phantomCount === 'number' ? state.phantomCount : 0,
    phantomsRecalled: typeof state.phantomsRecalled === 'number' ? state.phantomsRecalled : 0,
    phantomsMissed: typeof state.phantomsMissed === 'number' ? state.phantomsMissed : 0,
    history: Array.isArray(state.history) ? state.history : [],
  };
}

export async function loadGame(): Promise<SavedGame | null> {
  try {
    const raw = await AsyncStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedGame>;
    if (!looksLikeState(parsed.state)) return null;
    return {
      state: normalize(parsed.state),
      elapsed: typeof parsed.elapsed === 'number' ? parsed.elapsed : 0,
    };
  } catch {
    return null;
  }
}

export async function saveGame(saved: SavedGame): Promise<void> {
  try {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(saved));
  } catch {
    // Persisting is best-effort; the game keeps working without it.
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

export type { Settings };
