import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameState, Profile, normalizeProfile } from './engine';
import { GameSlot, SharedSettings, forStorage, readSavedGame } from './utils/saved';

/**
 * Where each of the two games is stored. Which kind of game a save is read as
 * is decided by the slot (see `readSavedGame`), so the slot and the key are
 * one thing here rather than two arguments that have to agree: paired by hand,
 * a transposition typechecks, restores every daily into the free game — which
 * has no staleness check — and destroys the free game on every launch.
 */
const GAME_KEYS: Record<GameSlot, string> = {
  free: 'sudokuoku:game:v1',
  daily: 'sudokuoku:daily:v1',
};

const PROFILE_KEY = 'sudokuoku:profile:v1';
const SHARED_SETTINGS_KEY = 'sudokuoku:settings:v1';
const LEGACY_STATS_KEY = 'sudokuoku:stats:v1';
const HELP_SEEN_KEY = 'sudokuoku:helpSeen:v1';

async function loadState(slot: GameSlot): Promise<GameState | null> {
  try {
    const raw = await AsyncStorage.getItem(GAME_KEYS[slot]);
    if (!raw) return null;
    // A save is untrusted input: see src/utils/saved.ts for what is believed.
    // The slot, not the save, says which kind of game is in it.
    return readSavedGame(JSON.parse(raw), slot);
  } catch {
    return null;
  }
}

async function saveState(slot: GameSlot, state: GameState): Promise<void> {
  try {
    await AsyncStorage.setItem(GAME_KEYS[slot], JSON.stringify(forStorage(state)));
  } catch {
    // Persisting is best-effort; the game keeps working without it.
  }
}

export const loadGame = () => loadState('free');
export const saveGame = (state: GameState) => saveState('free', state);
export const loadDailyGame = () => loadState('daily');
export const saveDailyGame = (state: GameState) => saveState('daily', state);

export async function clearDailyGame(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GAME_KEYS.daily);
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

/**
 * Appearance and assistance live outside both games: only one game is on
 * screen when they change, so the game states cannot be the record of them.
 */
export async function loadSharedSettings(): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(SHARED_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveSharedSettings(settings: SharedSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SHARED_SETTINGS_KEY, JSON.stringify(settings));
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
