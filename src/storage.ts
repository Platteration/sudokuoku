import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameState, Profile, normalizeProfile } from './engine';
import {
  GameSlot,
  SharedRecord,
  cleanSharedRecord,
  fields,
  forStorage,
  readSavedGame,
} from './utils/saved';

/**
 * Every record this app keeps, by name. The keys are `sudokuoku:<record>:v1`
 * with colons where the shared convention spells `<app>.<record>.v<N>` with
 * dots: they are namespaced and versioned, which is what the convention is
 * for, and renaming them for spelling would put every player's games through
 * a migration for nothing. Grandfathered, and pinned by the contract test.
 */
export const KEYS = {
  game: 'sudokuoku:game:v1',
  daily: 'sudokuoku:daily:v1',
  profile: 'sudokuoku:profile:v1',
  settings: 'sudokuoku:settings:v1',
} as const;

/** Records older builds wrote, read once and folded into the ones above. */
export const LEGACY_KEYS = {
  stats: 'sudokuoku:stats:v1',
  helpSeen: 'sudokuoku:helpSeen:v1',
} as const;

/**
 * Where each of the two games is stored. Which kind of game a save is read as
 * is decided by the slot (see `readSavedGame`), so the slot and the key are
 * one thing here rather than two arguments that have to agree: paired by hand,
 * a transposition typechecks, restores every daily into the free game — which
 * has no staleness check — and destroys the free game on every launch.
 */
const GAME_KEYS: Record<GameSlot, string> = {
  free: KEYS.game,
  daily: KEYS.daily,
};

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
    const raw = await AsyncStorage.getItem(KEYS.profile);
    if (raw) return normalizeProfile(JSON.parse(raw));
    // One-time migration from the older stats-only store.
    const legacy = await AsyncStorage.getItem(LEGACY_KEYS.stats);
    if (legacy) {
      const profile = normalizeProfile({ stats: JSON.parse(legacy) });
      await AsyncStorage.setItem(KEYS.profile, JSON.stringify(profile));
      await AsyncStorage.removeItem(LEGACY_KEYS.stats);
      return profile;
    }
    return normalizeProfile(null);
  } catch {
    return normalizeProfile(null);
  }
}

export async function saveProfile(profile: Profile): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.profile, JSON.stringify(profile));
  } catch {
    // best-effort
  }
}

export async function clearProfile(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEYS.profile);
  } catch {
    // best-effort
  }
}

/** Parsed JSON, or `UNREADABLE` when the bytes are not JSON at all. */
const UNREADABLE = Symbol('unreadable');
function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return UNREADABLE;
  }
}

/**
 * Appearance and assistance live outside both games: only one game is on
 * screen when they change, so the game states cannot be the record of them.
 * The record also carries whether the introduction has been seen, which an
 * older build kept under its own key; that flag is folded in here, once.
 *
 * The fold follows the shared migration shape: when the record already
 * carries the flag the old key is only deleted, otherwise the old value is
 * written into the record and the old key removed only once that write has
 * succeeded, so a failed write is retried on the next launch. The fold itself
 * never writes over a record that is not JSON: the flag is read from the old
 * key without being moved, and the record is left to the app's own next
 * settings write, which carries the flag from then on. A store that cannot be
 * read at all answers `seenIntro: null`, an unknown the screen treats as
 * "closed for this launch" and never writes back (see `SharedRecord`).
 */
export async function loadSharedSettings(): Promise<SharedRecord> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.settings);
    const parsed = raw === null ? null : parse(raw);
    const record = cleanSharedRecord(parsed === UNREADABLE ? null : parsed);
    if (typeof fields(parsed).seenIntro === 'boolean') {
      await remove(LEGACY_KEYS.helpSeen);
      return record;
    }
    const legacy = await AsyncStorage.getItem(LEGACY_KEYS.helpSeen);
    if (legacy === null) return record;
    const seenIntro = legacy === '1';
    if (parsed !== UNREADABLE) {
      try {
        await AsyncStorage.setItem(KEYS.settings, JSON.stringify({ ...fields(parsed), seenIntro }));
        await AsyncStorage.removeItem(LEGACY_KEYS.helpSeen);
      } catch {
        // The old flag stays where it is and is tried again next launch.
      }
    }
    return { ...record, seenIntro };
  } catch {
    return { settings: {}, seenIntro: null };
  }
}

/**
 * Writes the shared settings. The intro flag is written only when it is
 * known; when this launch could not read it, whatever the record already
 * holds is kept, so a read that failed once cannot turn into a flag the
 * player never set.
 */
export async function saveSharedSettings(record: SharedRecord): Promise<void> {
  try {
    const seenIntro = record.seenIntro ?? (await storedIntroFlag());
    await AsyncStorage.setItem(
      KEYS.settings,
      JSON.stringify(seenIntro === undefined ? record.settings : { ...record.settings, seenIntro }),
    );
  } catch {
    // best-effort
  }
}

/** The flag the record holds right now, when it holds one as a boolean. */
async function storedIntroFlag(): Promise<boolean | undefined> {
  const raw = await AsyncStorage.getItem(KEYS.settings);
  const flag = raw === null ? undefined : fields(parse(raw)).seenIntro;
  return typeof flag === 'boolean' ? flag : undefined;
}

async function remove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // best-effort
  }
}
