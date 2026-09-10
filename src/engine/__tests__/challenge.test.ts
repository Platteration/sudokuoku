import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_FORMAT,
  Challenge,
  ENGINE_REVISION,
  challengeFromState,
  challengeSettings,
  decodeChallenge,
  encodeChallenge,
  ghostRemainingAt,
  replayGhost,
  startChallenge,
} from '../challenge';
import { DEFAULT_SETTINGS, GameState, newGame, reduce } from '../game';
import { PRESETS } from '../presets';
import { ALL_SHIFT_KINDS } from '../transforms';

const base = DEFAULT_SETTINGS;

function sample(over: Partial<Challenge> = {}): Challenge {
  return {
    format: CHALLENGE_FORMAT,
    engine: ENGINE_REVISION,
    seed: 3790095737,
    difficulty: 'hard',
    rules: PRESETS.find((p) => p.id === 'classic')!.rules,
    ...over,
  };
}

/** Plays a game to the end, filling correct digits. */
function solve(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.status === 'playing' && guard++ < 400) {
    const q = s.values.findIndex((v) => v === 0);
    s = reduce(reduce(s, { type: 'select', pos: q }), { type: 'input', digit: s.solution[q], now: 0 });
  }
  return s;
}

describe('encoding', () => {
  it('round trips a challenge without a ghost', () => {
    const c = sample();
    const out = decodeChallenge(encodeChallenge(c));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.challenge.seed).toBe(c.seed);
    expect(out.challenge.difficulty).toBe('hard');
    expect(out.challenge.rules).toEqual(c.rules);
    expect(out.challenge.ghost).toBeUndefined();
  });

  it('round trips every preset and difficulty', () => {
    for (const preset of PRESETS) {
      for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as const) {
        const c = sample({ difficulty, rules: preset.rules });
        const out = decodeChallenge(encodeChallenge(c));
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.challenge.rules).toEqual(c.rules);
        expect(out.challenge.difficulty).toBe(difficulty);
      }
    }
  });

  it('round trips a full solve as a ghost, and stays short enough to share', () => {
    const solved = solve(newGame({ ...base, difficulty: 'easy' }, 4242));
    const c = challengeFromState({ ...solved, elapsed: 754 }, true);
    expect(c.ghost!.moves.length).toBeGreaterThan(30);

    const code = encodeChallenge(c);
    expect(code.length).toBeLessThan(400);

    const out = decodeChallenge(code);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.challenge.ghost!.moves).toEqual(c.ghost!.moves);
    expect(out.challenge.ghost!.totalSeconds).toBe(754);
  });

  it('preserves move times as gaps', () => {
    const c = sample({
      ghost: {
        moves: [
          { token: 0, digit: 5, seconds: 3 },
          { token: 80, digit: 0, seconds: 40 },
          { token: 41, digit: 9, seconds: 41 },
        ],
        totalSeconds: 60,
        hints: 2,
      },
    });
    const out = decodeChallenge(encodeChallenge(c));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.challenge.ghost!.moves).toEqual(c.ghost!.moves);
    expect(out.challenge.ghost!.hints).toBe(2);
  });
});

describe('rejecting bad codes', () => {
  it('refuses a payload from a different engine revision', () => {
    const code = encodeChallenge(sample({ engine: ENGINE_REVISION + 1 }));
    const out = decodeChallenge(code);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/older version/i);
  });

  it('refuses a different payload format', () => {
    const out = decodeChallenge(encodeChallenge(sample({ format: CHALLENGE_FORMAT + 1 })));
    expect(out.ok).toBe(false);
  });

  it('refuses truncated, mutated and junk codes rather than throwing', () => {
    const code = encodeChallenge(sample());
    expect(decodeChallenge(code.slice(0, 6)).ok).toBe(false);
    expect(decodeChallenge('').ok).toBe(false);
    expect(decodeChallenge('not a real code!!').ok).toBe(false);

    // Flip one character; the checksum must catch it.
    const flipped = code.slice(0, 4) + (code[4] === 'A' ? 'B' : 'A') + code.slice(5);
    const out = decodeChallenge(flipped);
    if (out.ok) {
      // A collision is possible but the board must still differ visibly.
      expect(out.challenge.seed).not.toBe(sample().seed);
    } else {
      expect(out.error).toBeTruthy();
    }
  });
});

describe('determinism: the property challenge links rest on', () => {
  it('two players on one seed meet the same board and the same shift schedule', () => {
    const settings = { ...base, difficulty: 'medium' as const };
    let a = newGame(settings, 987654321);
    let b = newGame(settings, 987654321);
    expect(a.values).toEqual(b.values);
    expect(a.solution).toEqual(b.solution);

    // The two play completely differently: A fills the first empty cell
    // correctly, B fills the last empty cell with a deliberately wrong digit.
    for (let i = 0; i < 15; i++) {
      const pa = a.values.findIndex((v) => v === 0);
      a = reduce(reduce(a, { type: 'select', pos: pa }), {
        type: 'input',
        digit: a.solution[pa],
        now: 0,
      });

      const pb = b.values.lastIndexOf(0);
      const wrong = (b.solution[pb] % 9) + 1;
      b = reduce(reduce(b, { type: 'select', pos: pb }), { type: 'input', digit: wrong, now: 0 });

      // Same move number, so the same shift must have fired for both.
      expect(a.moves).toBe(b.moves);
      expect(a.lastShift!.kind).toBe(b.lastShift!.kind);
      expect(a.lastShift!.description).toBe(b.lastShift!.description);
      expect(a.lastShift!.dest).toEqual(b.lastShift!.dest);
    }
  });

  it('a challenge always turns the phantom challenge off', () => {
    const phantom = PRESETS.find((p) => p.id === 'phantom')!.rules;
    expect(phantom.phantomMode).toBe(true);
    const c = sample({ rules: phantom });
    expect(challengeSettings(base, c).phantomMode).toBe(false);
    expect(startChallenge(base, c).settings.phantomMode).toBe(false);
    // Building one from a phantom game also strips it.
    const state = newGame({ ...base, phantomMode: true }, 11);
    expect(challengeFromState(state, false).rules.phantomMode).toBe(false);
  });

  it('keeps the player’s own look and assists, taking only the rules', () => {
    const mine = {
      ...base,
      theme: 'dark' as const,
      themePack: 'terminal',
      showMistakes: true,
      reduceMotion: true,
    };
    const settings = challengeSettings(mine, sample());
    expect(settings.theme).toBe('dark');
    expect(settings.themePack).toBe('terminal');
    expect(settings.showMistakes).toBe(true);
    expect(settings.reduceMotion).toBe(true);
  });

  it('starts a challenge in challenge mode on the encoded seed', () => {
    const c = sample();
    const state = startChallenge(base, c);
    expect(state.mode).toBe('challenge');
    expect(state.seed).toBe(c.seed);
    expect(state.settings.difficulty).toBe('hard');
  });
});

describe('ghost replay', () => {
  it('reproduces the sender’s finished board on the receiver’s device', () => {
    const solved = solve(newGame({ ...base, difficulty: 'easy' }, 5150));
    expect(solved.status).toBe('won');

    const code = encodeChallenge(challengeFromState(solved, true));
    const out = decodeChallenge(code);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const replayed = replayGhost(base, out.challenge);
    expect(replayed.status).toBe('won');
    expect(replayed.moves).toBe(solved.moves);
    expect(replayed.values).toEqual(solved.values);
    // The board also finished in the same orientation, so the same shifts ran.
    expect(replayed.tokens).toEqual(solved.tokens);
    expect(replayed.shiftCount).toBe(solved.shiftCount);
  });

  it('replays moves by token, so shifts moving the cells does not matter', () => {
    const solved = solve(newGame({ ...base, difficulty: 'easy' }, 606));
    expect(solved.shiftCount).toBeGreaterThan(20);
    const c = challengeFromState(solved, true);
    // Every logged move names a cell identity, never a position.
    for (const move of c.ghost!.moves) {
      expect(move.token).toBeGreaterThanOrEqual(0);
      expect(move.token).toBeLessThan(81);
    }
    expect(replayGhost(base, c).values).toEqual(solved.values);
  });

  it('reports how much the ghost had left at a moment in time', () => {
    const ghost = {
      moves: [
        { token: 1, digit: 5, seconds: 10 },
        { token: 2, digit: 6, seconds: 20 },
        { token: 3, digit: 7, seconds: 30 },
      ],
      totalSeconds: 30,
      hints: 0,
    };
    expect(ghostRemainingAt(ghost, 40, 0)).toBe(40);
    expect(ghostRemainingAt(ghost, 40, 15)).toBe(39);
    expect(ghostRemainingAt(ghost, 40, 30)).toBe(37);
    expect(ghostRemainingAt(ghost, 40, 9999)).toBe(37);
  });

  it('counts an erase as going backwards', () => {
    const ghost = {
      moves: [
        { token: 1, digit: 5, seconds: 5 },
        { token: 1, digit: 0, seconds: 6 },
      ],
      totalSeconds: 6,
      hints: 0,
    };
    expect(ghostRemainingAt(ghost, 10, 5)).toBe(9);
    expect(ghostRemainingAt(ghost, 10, 6)).toBe(10);
  });
});

describe('the move log', () => {
  it('records placements, erases and hints, and undo rewinds it', () => {
    let s = newGame({ ...base, enabledShifts: [] }, 31);
    expect(s.log).toEqual([]);

    const p = s.values.findIndex((v, i) => v === 0 && !s.given[i]);
    const token = s.tokens[p];
    s = reduce(reduce(s, { type: 'select', pos: p }), { type: 'input', digit: 4, now: 0 });
    expect(s.log).toEqual([{ token, digit: 4, seconds: 0 }]);

    s = reduce(s, { type: 'erase', now: 0 });
    expect(s.log).toHaveLength(2);
    expect(s.log[1]).toEqual({ token, digit: 0, seconds: 0 });

    s = reduce(reduce(s, { type: 'select', pos: p }), { type: 'hint', now: 0 });
    expect(s.log).toHaveLength(3);
    expect(s.log[2].digit).toBe(s.solution[s.tokens.indexOf(token)]);

    s = reduce(s, { type: 'undo' });
    expect(s.log).toHaveLength(2);
  });

  it('does not record notes, which are not moves', () => {
    let s = newGame({ ...base, enabledShifts: [] }, 32);
    const p = s.values.findIndex((v, i) => v === 0 && !s.given[i]);
    s = reduce(reduce(s, { type: 'select', pos: p }), { type: 'toggleNotesMode' });
    s = reduce(s, { type: 'input', digit: 3, now: 0 });
    expect(s.log).toEqual([]);
  });

  it('records the elapsed time of each move', () => {
    let s = newGame({ ...base, enabledShifts: [] }, 33);
    s = reduce(s, { type: 'tick' });
    s = reduce(s, { type: 'tick' });
    const p = s.values.findIndex((v) => v === 0);
    s = reduce(reduce(s, { type: 'select', pos: p }), { type: 'input', digit: 1, now: 0 });
    expect(s.log[0].seconds).toBe(2);
  });

  it('carries every shift kind through an encode and decode', () => {
    const c = sample({
      rules: { ...sample().rules, enabledShifts: [...ALL_SHIFT_KINDS] },
    });
    const out = decodeChallenge(encodeChallenge(c));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.challenge.rules.enabledShifts).toEqual(ALL_SHIFT_KINDS);
  });
});
