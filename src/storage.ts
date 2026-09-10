import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameState, Profile, normalizeProfile } from './engine';
import { SharedSettings, forStorage, readSavedGame } from './utils/saved';

const FREE_GAME_KEY = 'sudokuoku:game:v1';
const DAILY_GAME_KEY = 'sudokuoku:daily:v1';
const PROFILE_KEY = 'sudokuoku:profile:v1';
const SHARED_SETTINGS_KEY = 'sudokuoku:settings:v1';
const LEGACY_STATS_KEY = 'sudokuoku:stats:v1';
const HELP_SEEN_KEY = 'sudokuoku:helpSeen:v1';

async function loadState(key: string): Promise<GameState | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    // A save is untrusted input: see src/utils/saved.ts for what is believed.
    return readSavedGame(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function saveState(key: string, state: GameState): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(forStorage(state)));
  } catch {
    // Persisting is best-effort; the game keeps working without it.
  }
}

export const loadGame = () => loadState(FREE_GAME_KEY);
export const saveGame = (state: GameState) => saveState(FREE_GAME_KEY, state);
export const loadDailyGame = () => loadState(DAILY_GAME_KEY);
export const saveDailyGame = (state: GameState) => saveState(DAILY_GAME_KEY, state);

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
