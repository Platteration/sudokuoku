import AsyncStorage from '@react-native-async-storage/async-storage';
import { CELLS, GameState, Settings } from './engine';

const GAME_KEY = 'sudokuoku:game:v1';

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

export async function loadGame(): Promise<SavedGame | null> {
  try {
    const raw = await AsyncStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedGame>;
    if (!looksLikeState(parsed.state)) return null;
    return {
      state: parsed.state,
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

export type { Settings };
