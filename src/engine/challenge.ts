/**
 * Challenge links: hand a friend the identical board, with no server.
 *
 * This works because the game is deterministic in a specific way. The puzzle
 * comes from `generatePuzzle(createRng(seed), difficulty)`, and the shift that
 * fires after move N comes from `createRng(seed ^ (N * 0x9e3779b1))` — see
 * `shiftRng` in game.ts. Neither depends on which cell the player filled, so
 * two people playing the same seed meet the same board and the same schedule
 * of shifts, however differently they play.
 *
 * The one thing that is *not* a pure function of the move number is phantom
 * placement: `spawnPhantom` chooses among the cells that happen to be filled,
 * which depends on the player's own progress. Challenges therefore always turn
 * the phantom challenge off, so both sides really are solving the same puzzle.
 */
import { Difficulty } from './sudoku';
import { RULE_KEYS, Rules } from './presets';
import { ALL_SHIFT_KINDS, ShiftKind } from './transforms';
import { GameState, MoveRecord, Settings, newGame, reduce } from './game';

/** Shape of the payload. Bump when fields are added or reordered. */
export const CHALLENGE_FORMAT = 1;

/**
 * Bump whenever puzzle generation, the RNG, or the shift transforms change in
 * a way that alters what a seed means. A link from an older revision then
 * refuses to open rather than quietly producing a different board.
 */
export const ENGINE_REVISION = 1;

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

/** A recorded solve, replayed as the opponent's pace. */
export interface GhostRun {
  moves: MoveRecord[];
  totalSeconds: number;
  hints: number;
}

export interface Challenge {
  format: number;
  engine: number;
  seed: number;
  difficulty: Difficulty;
  rules: Rules;
  ghost?: GhostRun;
}

export type DecodeResult =
  | { ok: true; challenge: Challenge }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Bit packing
//
// A link has to survive being pasted into a message, so the payload is packed
// to the bit rather than serialised as JSON: a 60 move ghost is a few hundred
// characters this way instead of a few thousand.

class BitWriter {
  private bytes: number[] = [];
  private current = 0;
  private used = 0;

  write(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.current = (this.current << 1) | ((value >>> i) & 1);
      if (++this.used === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.used = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.used > 0) this.bytes.push(this.current << (8 - this.used));
    return Uint8Array.from(this.bytes);
  }
}

class BitReader {
  private index = 0;
  private used = 0;
  /** Set when a read ran past the end of the buffer. */
  overrun = false;

  constructor(private readonly bytes: Uint8Array) {}

  read(bits: number): number {
    let value = 0;
    for (let i = 0; i < bits; i++) {
      if (this.index >= this.bytes.length) {
        this.overrun = true;
        return value;
      }
      const bit = (this.bytes[this.index] >>> (7 - this.used)) & 1;
      value = (value << 1) | bit;
      if (++this.used === 8) {
        this.used = 0;
        this.index++;
      }
    }
    return value >>> 0;
  }
}

// ---------------------------------------------------------------------------
// base64url, written out because React Native has no dependable atob/btoa.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const chunk = (a << 16) | (b << 8) | c;
    const count = Math.min(3, bytes.length - i);
    out += ALPHABET[(chunk >>> 18) & 63];
    out += ALPHABET[(chunk >>> 12) & 63];
    if (count > 1) out += ALPHABET[(chunk >>> 6) & 63];
    if (count > 2) out += ALPHABET[chunk & 63];
  }
  return out;
}

function fromBase64url(text: string): Uint8Array | null {
  const clean = text.trim();
  const bytes: number[] = [];
  let chunk = 0;
  let count = 0;
  for (const ch of clean) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) return null;
    chunk = (chunk << 6) | value;
    if (++count === 4) {
      bytes.push((chunk >>> 16) & 255, (chunk >>> 8) & 255, chunk & 255);
      chunk = 0;
      count = 0;
    }
  }
  if (count === 1) return null; // a lone character cannot be a whole byte
  if (count === 2) bytes.push((chunk >>> 4) & 255);
  if (count === 3) bytes.push((chunk >>> 10) & 255, (chunk >>> 2) & 255);
  return Uint8Array.from(bytes);
}

/** FNV-1a over the payload, so a mangled paste is caught rather than played. */
function checksum(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return h & 0xff;
}

// ---------------------------------------------------------------------------
// Encode and decode

const MAX_GAP_SECONDS = 255;
const MAX_MOVES = 1023;

export function encodeChallenge(challenge: Challenge): string {
  const w = new BitWriter();
  w.write(challenge.format, 8);
  w.write(challenge.engine, 8);
  w.write(challenge.seed >>> 0, 32);
  w.write(Math.max(0, DIFFICULTIES.indexOf(challenge.difficulty)), 2);

  const r = challenge.rules;
  let shiftMask = 0;
  ALL_SHIFT_KINDS.forEach((kind, i) => {
    if (r.enabledShifts.includes(kind)) shiftMask |= 1 << i;
  });
  w.write(shiftMask, 8);
  w.write(clamp(r.shiftEvery, 1, 15), 4);
  w.write(clamp(r.shiftsPerMove, 1, 7), 3);
  w.write(r.phantomMode ? 1 : 0, 1);
  w.write(['entries', 'givens', 'both'].indexOf(r.phantomTarget), 2);
  w.write(clamp(r.phantomEvery, 1, 15), 4);
  w.write(clamp(r.phantomLockMoves, 1, 31), 5);
  w.write(clamp(r.phantomMax, 1, 7), 3);
  w.write(r.phantomMarkers ? 1 : 0, 1);

  const ghost = challenge.ghost;
  w.write(ghost ? 1 : 0, 1);
  if (ghost) {
    const moves = ghost.moves.slice(0, MAX_MOVES);
    w.write(moves.length, 10);
    w.write(clamp(ghost.totalSeconds, 0, 65535), 16);
    w.write(clamp(ghost.hints, 0, 255), 8);
    // Times are stored as gaps, which are small, rather than absolutes.
    let previous = 0;
    for (const move of moves) {
      w.write(move.token & 127, 7);
      w.write(move.digit & 15, 4);
      const gap = clamp(Math.round(move.seconds - previous), 0, MAX_GAP_SECONDS);
      w.write(gap, 8);
      previous += gap;
    }
  }

  const body = w.finish();
  const out = new Uint8Array(body.length + 1);
  out.set(body, 0);
  out[body.length] = checksum(body);
  return toBase64url(out);
}

export function decodeChallenge(text: string): DecodeResult {
  const bytes = fromBase64url(text);
  if (!bytes || bytes.length < 8) return { ok: false, error: 'That code is not complete.' };

  const body = bytes.subarray(0, bytes.length - 1);
  if (checksum(body) !== bytes[bytes.length - 1]) {
    return { ok: false, error: 'That code looks damaged. Ask for it again.' };
  }

  const r = new BitReader(body);
  const format = r.read(8);
  if (format !== CHALLENGE_FORMAT) {
    return { ok: false, error: 'That challenge came from a different version of the game.' };
  }
  const engine = r.read(8);
  if (engine !== ENGINE_REVISION) {
    return {
      ok: false,
      error: 'That challenge was made by an older version of the game, so the board would not match.',
    };
  }

  const seed = r.read(32) >>> 0;
  const difficulty = DIFFICULTIES[r.read(2)];

  const shiftMask = r.read(8);
  const enabledShifts: ShiftKind[] = ALL_SHIFT_KINDS.filter((_, i) => shiftMask & (1 << i));
  const shiftEvery = r.read(4);
  const shiftsPerMove = r.read(3);
  const phantomMode = r.read(1) === 1;
  const phantomTarget = (['entries', 'givens', 'both'] as const)[r.read(2)] ?? 'both';
  const phantomEvery = r.read(4);
  const phantomLockMoves = r.read(5);
  const phantomMax = r.read(3);
  const phantomMarkers = r.read(1) === 1;

  let ghost: GhostRun | undefined;
  if (r.read(1) === 1) {
    const count = r.read(10);
    const totalSeconds = r.read(16);
    const hints = r.read(8);
    const moves: MoveRecord[] = [];
    let seconds = 0;
    for (let i = 0; i < count; i++) {
      const token = r.read(7);
      const digit = r.read(4);
      seconds += r.read(8);
      moves.push({ token, digit, seconds });
    }
    ghost = { moves, totalSeconds, hints };
  }

  if (r.overrun) return { ok: false, error: 'That code is not complete.' };

  return {
    ok: true,
    challenge: {
      format,
      engine,
      seed,
      difficulty,
      rules: {
        enabledShifts,
        shiftEvery,
        shiftsPerMove,
        phantomMode,
        phantomTarget,
        phantomEvery,
        phantomLockMoves,
        phantomMax,
        phantomMarkers,
      },
      ghost,
    },
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Building and playing a challenge

/**
 * The rules a challenge is played under, keeping the player's own assists.
 *
 * Only the keys in RULE_KEYS are taken from the challenge, one at a time
 * rather than by spreading it: a decoded payload must never be able to reach
 * in and change the receiver's theme, motion or assistance preferences.
 */
export function challengeSettings(base: Settings, challenge: Challenge): Settings {
  const next: Settings = { ...base, difficulty: challenge.difficulty };
  // Driven by RULE_KEYS rather than a hand-written list, so a rule added to
  // presets.ts is carried by challenges automatically.
  const target = next as unknown as Record<string, unknown>;
  const source = challenge.rules as unknown as Record<string, unknown>;
  for (const key of RULE_KEYS) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  // Phantom placement depends on the player's own board, so it would drift
  // between the two sides. A challenge is always a straight race.
  next.phantomMode = false;
  return next;
}

/** Builds a challenge from a game, optionally carrying the solve as a ghost. */
export function challengeFromState(state: GameState, withGhost: boolean): Challenge {
  return {
    format: CHALLENGE_FORMAT,
    engine: ENGINE_REVISION,
    seed: state.seed,
    difficulty: state.settings.difficulty,
    rules: {
      enabledShifts: state.settings.enabledShifts,
      shiftEvery: state.settings.shiftEvery,
      shiftsPerMove: state.settings.shiftsPerMove,
      phantomMode: false,
      phantomTarget: state.settings.phantomTarget,
      phantomEvery: state.settings.phantomEvery,
      phantomLockMoves: state.settings.phantomLockMoves,
      phantomMax: state.settings.phantomMax,
      phantomMarkers: state.settings.phantomMarkers,
    },
    ghost:
      withGhost && state.log.length > 0
        ? { moves: state.log, totalSeconds: state.elapsed, hints: state.hintsUsed }
        : undefined,
  };
}

/** Starts the game a challenge describes. */
export function startChallenge(base: Settings, challenge: Challenge): GameState {
  return newGame(challengeSettings(base, challenge), challenge.seed, { mode: 'challenge' });
}

/**
 * Replays a ghost against a fresh game of the same challenge. Used to check a
 * recorded solve really does reproduce the sender's board, and to work out
 * where they stood at a given moment.
 */
export function replayGhost(base: Settings, challenge: Challenge): GameState {
  let state = startChallenge(base, challenge);
  for (const move of challenge.ghost?.moves ?? []) {
    const pos = state.tokens.indexOf(move.token);
    if (pos < 0) continue;
    state = reduce(state, { type: 'select', pos });
    state =
      move.digit === 0
        ? reduce(state, { type: 'erase', now: 0 })
        : reduce(state, { type: 'input', digit: move.digit, now: 0 });
  }
  return state;
}

/**
 * How many cells the ghost still had to fill at `seconds`. Drives the pace
 * bar: compare it with the player's own remaining count.
 */
export function ghostRemainingAt(
  ghost: GhostRun,
  startingEmpty: number,
  seconds: number,
): number {
  let filled = 0;
  for (const move of ghost.moves) {
    if (move.seconds > seconds) break;
    filled += move.digit === 0 ? -1 : 1;
  }
  return Math.max(0, startingEmpty - filled);
}
