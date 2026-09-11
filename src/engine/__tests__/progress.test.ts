import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, GameState, newGame, reduce } from '../game';
import {
  BADGES,
  CLEAN_HINT_LIMIT,
  DailyResult,
  MAX_FREEZES,
  isCleanWin,
  isDailyStale,
  isTodaysDaily,
  applyStreakFreeze,
  currentStreak,
  grantMonthlyFreeze,
  refreshStreak,
  dailyConfig,
  dailySeed,
  dailySettings,
  dateKey,
  emptyProfile,
  formatClock,
  isDateKey,
  levelInfo,
  MAX_STREAK_DAYS,
  normalizeProfile,
  parseDateKey,
  profileStreak,
  recordGameStart,
  recordGameWin,
  shareText,
  shiftDateKey,
  todaysDailyInProgress,
  unlockedBadges,
  xpForLevel,
  xpForWin,
} from '../progress';

/** Plays a game to completion by filling correct digits. */
function winGame(state: GameState, elapsed = 300): GameState {
  let s = state;
  let guard = 0;
  while (s.status === 'playing' && guard++ < 600) {
    const q = s.values.findIndex((v, i) => v === 0 && !(s.phantoms[i] && !s.phantoms[i]!.unlocked && s.moves < s.phantoms[i]!.unlockAtMove));
    s = reduce(reduce(s, { type: 'select', pos: q }), { type: 'input', digit: s.solution[q] });
  }
  expect(s.status).toBe('won');
  return { ...s, elapsed };
}

/** Runs `fn` with the process in `tz`, and puts TZ back however it was. */
function inZone(tz: string, fn: () => void): void {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'TZ');
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (had) process.env.TZ = before;
    else delete process.env.TZ;
  }
}

/**
 * Keys written out rather than stepped: stepping is the thing under test, so
 * the sample must not be built with it. Covers both date-line skips, both leap
 * cases and every month end.
 */
function sampleKeys(): string[] {
  const out: string[] = [];
  for (const y of [1970, 1994, 1995, 2000, 2011, 2012, 2024, 2026, 2036]) {
    for (let m = 1; m <= 12; m++) {
      for (const d of [1, 2, 15, 28, 29, 30, 31]) {
        out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }
  }
  return out;
}

/**
 * Zones that have skipped a whole calendar day at the date line, and the day
 * each one lands on after the skip. Pacific/Apia and Pacific/Fakaofo never had
 * a 2011-12-30; Pacific/Enderbury and Pacific/Kiritimati never had a
 * 1994-12-31.
 */
const SKIPPED_DAY_ZONES: [string, string][] = [
  ['Pacific/Apia', '2011-12-31'],
  ['Pacific/Fakaofo', '2011-12-31'],
  ['Pacific/Enderbury', '1995-01-01'],
  ['Pacific/Kiritimati', '1995-01-01'],
];

describe('date keys', () => {
  it('formats and parses local dates', () => {
    const d = new Date(2026, 8, 6);
    expect(dateKey(d)).toBe('2026-09-06');
    expect(dateKey(parseDateKey('2026-09-06'))).toBe('2026-09-06');
    expect(shiftDateKey('2026-09-06', -1)).toBe('2026-09-05');
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateKey('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftDateKey('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftDateKey('2023-03-01', -1)).toBe('2023-02-28');
  });

  const zones = ['UTC', 'America/New_York', 'Australia/Lord_Howe', ...SKIPPED_DAY_ZONES.map(([z]) => z)];
  for (const tz of zones) {
    it(`steps every key it accepts onto a different day in ${tz}`, () => {
      inZone(tz, () => {
        const accepted = sampleKeys().filter(isDateKey);
        expect(accepted.length).toBeGreaterThan(600);
        for (const key of accepted) {
          const back = shiftDateKey(key, -1);
          const on = shiftDateKey(key, 1);
          // The whole streak walk rests on this: a step that stands still on
          // a key isDateKey accepts is a loop with no way out of it. Four
          // zones skipped a calendar day, and asking the local calendar for
          // midnight of a day that was never struck answers with the day
          // after it — so this used to be the identity here.
          expect(back).not.toBe(key);
          expect(on).not.toBe(key);
          // Four-digit years make the written order the calendar order.
          expect(back < key).toBe(true);
          expect(on > key).toBe(true);
        }
      });
    });
  }

  for (const [tz, key] of SKIPPED_DAY_ZONES) {
    it(`steps back from the day after the skipped one in ${tz}`, () => {
      inZone(tz, () => {
        // The key is a real day there and the app accepts it, which is what
        // made this reachable with no tampering at all: a device in this zone
        // with its clock on this date, solving that day's daily.
        expect(isDateKey(key)).toBe(true);
        expect(shiftDateKey(key, -1)).not.toBe(key);
      });
    });
  }
});

describe('daily config', () => {
  it('gives every player the same seed for a day and different seeds across days', () => {
    expect(dailySeed('2026-09-06')).toBe(dailySeed('2026-09-06'));
    expect(dailySeed('2026-09-06')).not.toBe(dailySeed('2026-09-07'));
    const a = newGame(DEFAULT_SETTINGS, dailySeed('2026-09-06'));
    const b = newGame(DEFAULT_SETTINGS, dailySeed('2026-09-06'));
    expect(a.values).toEqual(b.values);
  });

  it('follows the weekday and marks phantom days', () => {
    expect(dailyConfig('2026-09-06')).toMatchObject({ difficulty: 'expert', phantom: true }); // Sunday
    expect(dailyConfig('2026-09-07')).toMatchObject({ difficulty: 'easy', phantom: false }); // Monday
    expect(dailyConfig('2026-09-09')).toMatchObject({ difficulty: 'medium', phantom: true }); // Wednesday
    expect(dailyConfig('2026-09-12')).toMatchObject({ difficulty: 'hard', phantom: false }); // Saturday
    expect(dailyConfig('2026-09-09').label).toBe('Medium · Phantom day');
  });

  it('fixes the rules but keeps the player assists', () => {
    const base = { ...DEFAULT_SETTINGS, difficulty: 'easy' as const, enabledShifts: [], shiftEvery: 5, showMistakes: true, theme: 'dark' as const };
    const s = dailySettings(base, dailyConfig('2026-09-06'));
    expect(s.difficulty).toBe('expert');
    expect(s.shiftEvery).toBe(1);
    expect(s.enabledShifts.length).toBe(7);
    expect(s.enabledShifts).not.toContain('relabel');
    expect(s.phantomMode).toBe(true);
    expect(s.showMistakes).toBe(true);
    expect(s.theme).toBe('dark');
  });
});

describe('streaks', () => {
  const result = (key: string): DailyResult => ({
    key, difficulty: 'medium', phantom: false, elapsed: 100, moves: 50, shifts: 49, hints: 0, phantomsRecalled: 0, phantomsMissed: 0, xp: 100,
  });

  it('counts consecutive days ending today', () => {
    const daily = { '2026-09-04': result('2026-09-04'), '2026-09-05': result('2026-09-05'), '2026-09-06': result('2026-09-06') };
    expect(currentStreak(daily, '2026-09-06')).toBe(3);
  });

  it('keeps the streak alive while today is still open', () => {
    const daily = { '2026-09-04': result('2026-09-04'), '2026-09-05': result('2026-09-05') };
    expect(currentStreak(daily, '2026-09-06')).toBe(2);
    expect(currentStreak(daily, '2026-09-07')).toBe(0);
  });

  it('is zero with a gap', () => {
    const daily = { '2026-09-03': result('2026-09-03'), '2026-09-06': result('2026-09-06') };
    expect(currentStreak(daily, '2026-09-06')).toBe(1);
    expect(currentStreak({}, '2026-09-06')).toBe(0);
  });
});

describe('xp and levels', () => {
  it('rewards difficulty, shifts and recalls, and penalises hints', () => {
    const base = newGame({ ...DEFAULT_SETTINGS, difficulty: 'medium' }, 1);
    expect(xpForWin({ ...base, shiftCount: 40 })).toBe(140);
    expect(xpForWin({ ...base, shiftCount: 400 })).toBe(200); // shift bonus capped
    expect(xpForWin({ ...base, shiftCount: 0, phantomsRecalled: 3 })).toBe(130);
    expect(xpForWin({ ...base, shiftCount: 0, hintsUsed: 2 })).toBe(70);
    expect(xpForWin({ ...base, shiftCount: 0, hintsUsed: 20 })).toBe(10); // floor
    expect(xpForWin({ ...base, shiftCount: 0, mode: 'daily' })).toBe(150);
    expect(xpForWin({ ...newGame({ ...DEFAULT_SETTINGS, difficulty: 'expert' }, 1), shiftCount: 0 })).toBe(275);
  });

  it('levels grow quadratically with titles', () => {
    expect(levelInfo(0)).toMatchObject({ level: 1, title: 'Newcomer', into: 0, span: 100 });
    expect(levelInfo(99).level).toBe(1);
    expect(levelInfo(100)).toMatchObject({ level: 2, title: 'Apprentice', into: 0, span: 300 });
    expect(levelInfo(xpForLevel(5))).toMatchObject({ level: 5, title: 'Ring Walker' });
    expect(levelInfo(xpForLevel(20) + 5).title).toBe('Sudokuoku Sage');
    expect(xpForLevel(1)).toBe(0);
  });
});

describe('profile', () => {
  it('normalizes partial data', () => {
    const p = normalizeProfile({ xp: 250, stats: { hard: { won: 2 } } });
    expect(p.xp).toBe(250);
    expect(p.stats.hard.won).toBe(2);
    expect(p.stats.hard.played).toBe(0);
    expect(p.stats.easy.bestTime).toBeNull();
    expect(p.totals.won).toBe(0);
    expect(normalizeProfile(null).xp).toBe(0);
  });

  it('records starts and wins with stats, xp and badges', () => {
    let profile = recordGameStart(emptyProfile(), 'easy');
    expect(profile.stats.easy.played).toBe(1);
    expect(profile.totals.played).toBe(1);

    const won = winGame(newGame({ ...DEFAULT_SETTINGS, difficulty: 'easy', enabledShifts: [] }, 3), 240);
    const out = recordGameWin(profile, won, new Date(2026, 8, 6, 12));
    expect(out.xpGained).toBe(50);
    expect(out.profile.xp).toBe(50);
    expect(out.profile.stats.easy.won).toBe(1);
    expect(out.profile.stats.easy.bestTime).toBe(240);
    expect(out.profile.totals.hintlessWins).toBe(1);
    expect(out.newBadges.map((b) => b.id)).toEqual(['first-win', 'no-hints']);
    expect(out.leveledUp).toBe(false);
    expect(out.profile.badges['first-win']).toMatch(/^2026-09-06/);

    // A second win does not re-award the same badges.
    const again = recordGameWin(out.profile, won, new Date(2026, 8, 7));
    expect(again.newBadges).toEqual([]);
    expect(again.leveledUp).toBe(true); // 100 xp reaches level 2
  });

  it('records a daily result once, updates streaks and daily badges', () => {
    const cfg = dailyConfig('2026-09-07'); // Monday, easy
    const settings = dailySettings({ ...DEFAULT_SETTINGS, enabledShifts: [] }, cfg);
    const state = winGame(newGame({ ...settings, enabledShifts: [] }, dailySeed(cfg.key), { mode: 'daily', dailyKey: cfg.key }), 500);
    let profile = emptyProfile();
    profile.daily['2026-09-06'] = { key: '2026-09-06', difficulty: 'expert', phantom: true, elapsed: 1, moves: 1, shifts: 0, hints: 0, phantomsRecalled: 0, phantomsMissed: 0, xp: 1 };
    profile.daily['2026-09-05'] = { ...profile.daily['2026-09-06'], key: '2026-09-05' };
    const out = recordGameWin(profile, state, new Date(2026, 8, 7, 9));
    expect(out.profile.daily['2026-09-07']).toMatchObject({ key: '2026-09-07', difficulty: 'easy', elapsed: 500, xp: 75 });
    expect(out.streak).toBe(3);
    expect(out.profile.bestStreak).toBe(3);
    expect(out.profile.totals.dailiesCompleted).toBe(1);
    expect(out.newBadges.map((b) => b.id)).toContain('daily-first');
    expect(out.newBadges.map((b) => b.id)).toContain('streak-3');

    // Recording the same daily again does not duplicate it.
    const dup = recordGameWin(out.profile, state, new Date(2026, 8, 7, 10));
    expect(dup.profile.totals.dailiesCompleted).toBe(1);
  });

  it('share text reads like a result card', () => {
    const r: DailyResult = { key: '2026-09-09', difficulty: 'medium', phantom: true, elapsed: 754, moves: 60, shifts: 59, hints: 0, phantomsRecalled: 4, phantomsMissed: 1, xp: 210 };
    expect(shareText(r, 5)).toBe(
      'Sudokuoku Daily 2026-09-09 · Medium · Phantom day\n⏱ 12:34 · 60 moves · 59 shifts · 👻 4/5 · no hints\n🔥 5 day streak · +210 XP',
    );
  });

  it('badge ids are unique', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });
});

describe('game timer and load', () => {
  it('ticks only while playing and load replaces the state', () => {
    const a = newGame(DEFAULT_SETTINGS, 1);
    expect(reduce(a, { type: 'tick' }).elapsed).toBe(1);
    const b = newGame(DEFAULT_SETTINGS, 2, { mode: 'daily', dailyKey: '2026-09-06' });
    expect(reduce(a, { type: 'load', state: b })).toBe(b);
    expect(b.mode).toBe('daily');
    expect(reduce({ ...a, status: 'won' }, { type: 'tick' }).elapsed).toBe(0);
  });
});

describe('a daily that has outlived its day', () => {
  const daily = (key: string | null): GameState =>
    newGame(DEFAULT_SETTINGS, 1, { mode: 'daily', dailyKey: key });

  it('is stale once the calendar day has moved on', () => {
    // The app can sit open across midnight, so this is not a hypothetical.
    expect(isDailyStale(daily('2026-09-06'), '2026-09-06')).toBe(false);
    expect(isDailyStale(daily('2026-09-05'), '2026-09-06')).toBe(true);
    expect(isDailyStale(daily(null), '2026-09-06')).toBe(true);
  });

  it('never calls a free game stale', () => {
    expect(isDailyStale(newGame(DEFAULT_SETTINGS, 1), '2026-09-06')).toBe(false);
  });

  it('is not today\u2019s daily, however it got on screen', () => {
    expect(isTodaysDaily(daily('2026-09-06'), '2026-09-06')).toBe(true);
    expect(isTodaysDaily(daily('2026-09-05'), '2026-09-06')).toBe(false);
    expect(isTodaysDaily(newGame(DEFAULT_SETTINGS, 1), '2026-09-06')).toBe(false);
  });

  it('does not count as today\u2019s daily being in progress', () => {
    // Left on screen across midnight, with the free game parked behind it:
    // today's puzzle has never been started, so the card must not say it is
    // under way and the button must not offer to go back to it.
    const free = newGame(DEFAULT_SETTINGS, 2);
    expect(todaysDailyInProgress(daily('2026-09-05'), free, '2026-09-06')).toBe(false);
    // Today's daily counts wherever it is: on screen, or parked behind free play.
    expect(todaysDailyInProgress(daily('2026-09-06'), free, '2026-09-06')).toBe(true);
    expect(todaysDailyInProgress(free, daily('2026-09-06'), '2026-09-06')).toBe(true);
    // A stale one parked behind free play is no more today's than an absent one.
    expect(todaysDailyInProgress(free, daily('2026-09-05'), '2026-09-06')).toBe(false);
    expect(todaysDailyInProgress(free, null, '2026-09-06')).toBe(false);
  });

  it('does not count a finished daily as in progress', () => {
    const done: GameState = { ...daily('2026-09-06'), status: 'won' };
    expect(todaysDailyInProgress(done, null, '2026-09-06')).toBe(false);
    expect(todaysDailyInProgress(newGame(DEFAULT_SETTINGS, 2), done, '2026-09-06')).toBe(false);
  });
});

describe('streak freezes', () => {
  const day = (key: string): DailyResult => ({
    key, difficulty: 'easy', phantom: false, elapsed: 1, moves: 1, shifts: 0, hints: 0,
    phantomsRecalled: 0, phantomsMissed: 0, xp: 1,
  });

  function withDays(keys: string[], extra: Partial<ReturnType<typeof emptyProfile>> = {}) {
    const p = emptyProfile();
    for (const k of keys) p.daily[k] = day(k);
    return { ...p, ...extra };
  }

  it('grants one freeze per calendar month, capped', () => {
    let p = emptyProfile();
    p = grantMonthlyFreeze(p, '2026-09-06');
    expect(p.freezes).toBe(1);
    expect(p.lastFreezeGrant).toBe('2026-09');
    // Same month again is a no-op.
    expect(grantMonthlyFreeze(p, '2026-09-20')).toBe(p);
    p = grantMonthlyFreeze(p, '2026-10-01');
    p = grantMonthlyFreeze(p, '2026-11-01');
    expect(p.freezes).toBe(3);
    p = grantMonthlyFreeze(p, '2026-12-01');
    expect(p.freezes).toBe(MAX_FREEZES);
  });

  it('spends a freeze to cover a missed day and keeps the streak alive', () => {
    // Played the 3rd and 4th, missed the 5th, opening the app on the 6th.
    const p = withDays(['2026-09-03', '2026-09-04'], { freezes: 1 });
    expect(currentStreak(p.daily, '2026-09-06')).toBe(0);
    const after = applyStreakFreeze(p, '2026-09-06');
    expect(after.freezes).toBe(0);
    expect(after.frozenDays['2026-09-05']).toBe(true);
    expect(currentStreak(after.daily, '2026-09-06', after.frozenDays)).toBe(3);
  });

  it('does not spend a freeze when there is nothing to save', () => {
    // Yesterday was played, so no gap.
    const played = withDays(['2026-09-05'], { freezes: 1 });
    expect(applyStreakFreeze(played, '2026-09-06')).toBe(played);
    // The streak is already broken two days back, so a freeze would not rescue it.
    const broken = withDays(['2026-09-01'], { freezes: 1 });
    expect(applyStreakFreeze(broken, '2026-09-06')).toBe(broken);
    // No freezes banked.
    const poor = withDays(['2026-09-03', '2026-09-04'], { freezes: 0 });
    expect(applyStreakFreeze(poor, '2026-09-06')).toBe(poor);
  });

  it('only ever covers one day per opening', () => {
    const p = withDays(['2026-09-02'], { freezes: 3 });
    const after = refreshStreak(p, '2026-09-06');
    // 09-03, 09-04 and 09-05 are all missing, so nothing is rescued.
    expect(Object.keys(after.frozenDays)).toEqual([]);
    expect(after.freezes).toBe(3);
  });

  it('refreshStreak grants then spends in one call', () => {
    const p = withDays(['2026-09-03', '2026-09-04'], { freezes: 0, lastFreezeGrant: null });
    const after = refreshStreak(p, '2026-09-06');
    expect(after.freezes).toBe(0); // granted one, spent it
    expect(after.frozenDays['2026-09-05']).toBe(true);
    expect(currentStreak(after.daily, '2026-09-06', after.frozenDays)).toBe(3);
  });

  it('profileStreak counts the days a freeze rescued', () => {
    // Played the 3rd and 4th, missed the 5th, the freeze covered it.
    const rescued = refreshStreak(
      withDays(['2026-09-03', '2026-09-04'], { freezes: 1 }),
      '2026-09-06',
    );
    expect(rescued.frozenDays['2026-09-05']).toBe(true);
    // Every screen has to agree with the one that spent the freeze, so the
    // profile-wide helper is what they all call.
    expect(profileStreak(rescued, '2026-09-06')).toBe(3);
    expect(profileStreak(rescued, '2026-09-06')).toBe(
      currentStreak(rescued.daily, '2026-09-06', rescued.frozenDays),
    );
  });

  it('normalizes a profile saved before freezes existed', () => {
    const p = normalizeProfile({ xp: 10 });
    expect(p.freezes).toBe(0);
    expect(p.frozenDays).toEqual({});
    expect(p.lastFreezeGrant).toBeNull();
  });
});

describe('badge integrity', () => {
  it('does not hand out the speed badge for a hint-spammed win', () => {
    const fast = winGame(newGame({ ...DEFAULT_SETTINGS, difficulty: 'medium', enabledShifts: [] }, 61), 120);
    const clean = recordGameWin(emptyProfile(), fast, new Date(2026, 8, 6));
    expect(clean.newBadges.map((b) => b.id)).toContain('speed');

    const hinted = { ...fast, hintsUsed: 40 };
    const out = recordGameWin(emptyProfile(), hinted, new Date(2026, 8, 6));
    expect(out.newBadges.map((b) => b.id)).not.toContain('speed');
    expect(out.newBadges.map((b) => b.id)).not.toContain('no-hints');
    // The win itself still counts, and XP never goes negative.
    expect(out.newBadges.map((b) => b.id)).toContain('first-win');
    expect(out.xpGained).toBe(10);
  });
});

describe('badges cannot be farmed with hints', () => {
  const winWith = (over: Partial<ReturnType<typeof winGame>>) => ({
    ...winGame(newGame({ ...DEFAULT_SETTINGS, difficulty: 'hard', enabledShifts: [] }, 62), 200),
    ...over,
  });

  it('a hint-heavy win still counts as a win but earns no skill badge', () => {
    const hinted = winWith({ hintsUsed: 30 });
    const out = recordGameWin(emptyProfile(), hinted, new Date(2026, 8, 6));
    expect(out.profile.stats.hard.won).toBe(1);
    expect(out.profile.stats.hard.cleanWins).toBe(0);
    expect(out.profile.totals.cleanWins).toBe(0);
    const ids = out.newBadges.map((b) => b.id);
    expect(ids).toContain('first-win');
    expect(ids).not.toContain('win-hard');
    expect(ids).not.toContain('speed');
  });

  it('a win inside the hint limit earns it', () => {
    const clean = winWith({ hintsUsed: CLEAN_HINT_LIMIT });
    const out = recordGameWin(emptyProfile(), clean, new Date(2026, 8, 6));
    expect(out.profile.stats.hard.cleanWins).toBe(1);
    expect(out.newBadges.map((b) => b.id)).toContain('win-hard');
    expect(isCleanWin(clean)).toBe(true);
    expect(isCleanWin(winWith({ hintsUsed: CLEAN_HINT_LIMIT + 1 }))).toBe(false);
  });

  it('Full Spectrum needs a clean win at every difficulty', () => {
    let profile = emptyProfile();
    for (const d of ['easy', 'medium', 'hard', 'expert'] as const) {
      const hintedWin = {
        ...winGame(newGame({ ...DEFAULT_SETTINGS, difficulty: d, enabledShifts: [] }, 63), 200),
        hintsUsed: 20,
      };
      profile = recordGameWin(profile, hintedWin, new Date(2026, 8, 6)).profile;
    }
    expect(profile.badges['all-difficulties']).toBeUndefined();
    expect(profile.totals.won).toBe(4);
  });

  it('normalizes a profile saved before clean wins were tracked', () => {
    const p = normalizeProfile({ stats: { hard: { won: 5 } }, totals: { won: 5 } });
    expect(p.stats.hard.cleanWins).toBe(0);
    expect(p.totals.cleanWins).toBe(0);
    expect(p.totals.won).toBe(5);
  });
});

describe('a profile or a save that was edited', () => {
  const result = (key: string): DailyResult => ({
    key, difficulty: 'medium', phantom: false, elapsed: 100, moves: 50, shifts: 49, hints: 0,
    phantomsRecalled: 0, phantomsMissed: 0, xp: 100,
  });

  it('tells a date key from a string that only looks like one', () => {
    expect(isDateKey(dateKey(new Date()))).toBe(true);
    expect(isDateKey('2026-09-06')).toBe(true);
    expect(isDateKey('NaN-NaN-NaN')).toBe(false);
    expect(isDateKey('2026-9-6')).toBe(false);
    expect(isDateKey('2026-13-45')).toBe(false); // parses, but not back to itself
    expect(isDateKey('')).toBe(false);
    expect(isDateKey(42)).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });

  it('holds no streak on a day that is not a date, and stops walking', () => {
    // parseDateKey gives an Invalid Date and dateKey renders it back as the
    // same string, so the walk-back never leaves the key: the loop froze the
    // JS thread inside the win effect and the app had to be force-quit.
    expect(shiftDateKey('NaN-NaN-NaN', -1)).toBe('NaN-NaN-NaN');
    expect(currentStreak({ 'NaN-NaN-NaN': result('NaN-NaN-NaN') }, 'NaN-NaN-NaN')).toBe(0);
    expect(currentStreak({}, 'NaN-NaN-NaN', { 'NaN-NaN-NaN': true })).toBe(0);
    // A real day is unaffected.
    expect(currentStreak({ '2026-09-06': result('2026-09-06') }, '2026-09-06')).toBe(1);
  });

  it('counts from no day the app did not write', () => {
    // '2026-9-6' is not how a day is written here, but it parses and steps
    // onto a real one, so a today that came off the disk in that form would
    // otherwise be credited with the whole run standing behind it.
    const daily = {
      '2026-09-05': result('2026-09-05'),
      '2026-09-04': result('2026-09-04'),
    };
    expect(currentStreak(daily, '2026-9-6')).toBe(0);
    expect(currentStreak(daily, '2026-09-06')).toBe(2);
  });

  it('stops at a key it could never have written itself', () => {
    // The walk steps by calendar days, and below year 1000 it steps out of
    // the four-digit form every stored key has. Such a key is not a day this
    // app recorded, and stepping on from one lands back in the 1900s.
    const daily = { '1000-01-01': result('1000-01-01'), '999-12-31': result('999-12-31') };
    expect(isDateKey('999-12-31')).toBe(false);
    expect(shiftDateKey('1000-01-01', -1)).toBe('999-12-31');
    expect(currentStreak(daily, '1000-01-01')).toBe(1);
  });

  it('counts a long run up to a bound rather than walking whatever is there', () => {
    // The walk runs on the JS thread inside a React commit, over a map that
    // came off the disk. Ten years is past anything a player can hold, and
    // the bound is what makes the walk finite whether or not the calendar is.
    const daily: Record<string, DailyResult> = {};
    let key = '2026-09-11';
    for (let i = 0; i < MAX_STREAK_DAYS + 400; i++) {
      daily[key] = result(key);
      key = shiftDateKey(key, -1);
    }
    expect(Object.keys(daily).length).toBe(MAX_STREAK_DAYS + 400);
    expect(currentStreak(daily, '2026-09-11')).toBe(MAX_STREAK_DAYS);
  });

  for (const [tz, key] of SKIPPED_DAY_ZONES) {
    it(`counts and records a daily in ${tz}, which skipped the day before ${key}`, () => {
      inZone(tz, () => {
        // No tampering in this one: a device in this zone, its clock on this
        // date, solving that day's real daily. Stepping the day back used to
        // land on the day it started from, and recordGameWin never returned.
        const won = winGame(newGame({ ...DEFAULT_SETTINGS, enabledShifts: [] }, 30), 100);
        const daily: GameState = { ...won, mode: 'daily', dailyKey: key };
        const out = recordGameWin(emptyProfile(), daily, parseDateKey(key));
        expect(Object.keys(out.profile.daily)).toEqual([key]);
        expect(out.streak).toBe(1);
        expect(out.profile.bestStreak).toBe(1);
        // And the profile that win wrote reads the same way afterwards.
        expect(profileStreak(normalizeProfile(out.profile), key)).toBe(1);
      });
    });
  }

  it('records a won daily only under a real day', () => {
    const won = winGame(newGame({ ...DEFAULT_SETTINGS, enabledShifts: [] }, 30), 100);
    const hostile: GameState = { ...won, mode: 'daily', dailyKey: 'NaN-NaN-NaN' };
    const out = recordGameWin(emptyProfile(), hostile, new Date(2026, 8, 11));
    expect(out.profile.daily).toEqual({});
    expect(out.profile.totals.dailiesCompleted).toBe(0);
    expect(out.streak).toBe(0);
    // The win itself still counts; it is only not a daily.
    expect(out.profile.totals.won).toBe(1);
  });

  it('answers dailyConfig for any key rather than throwing', () => {
    // The Daily sheet's only button reaches this with a key off the disk.
    expect(() => dailyConfig('not-a-date')).not.toThrow();
    expect(dailyConfig('not-a-date').difficulty).toBe('medium');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });

  it('drops stored dailies that are not days, or not results', () => {
    const p = normalizeProfile({
      daily: {
        '2026-09-06': result('2026-09-06'),
        'NaN-NaN-NaN': result('NaN-NaN-NaN'),
        yesterday: result('yesterday'),
        '2026-09-07': 'done',
      },
    });
    expect(Object.keys(p.daily)).toEqual(['2026-09-06']);
    expect(currentStreak(p.daily, '2026-09-06')).toBe(1);
  });

  it('takes a stored daily from its day, not from what the record claims', () => {
    const key = '2026-09-07'; // a Monday: easy, no phantoms
    expect(dailyConfig(key)).toMatchObject({ difficulty: 'easy', phantom: false });
    const p = normalizeProfile({
      daily: {
        [key]: { ...result(key), key: 'not-a-date', difficulty: 'expert', phantom: true },
      },
    });
    const stored = p.daily[key];
    // Both claims are values the app itself writes on other days, so nothing
    // coerces them: a daily's difficulty and phantom rule are a function of
    // its date, and a record does not get to say otherwise. Believed, the
    // card prints the day's own label ("Easy") beside a ghost section the day
    // never had, and the Daily sheet swaps its Hints stat for Recalled.
    expect(stored.difficulty).toBe('easy');
    expect(stored.phantom).toBe(false);
    expect(shareText(stored, 1)).not.toContain('👻');
    // dailyConfig is handed result.key by the share card, and a key that is
    // not a date used to take the button down with it.
    expect(stored.key).toBe(key);
    expect(() => shareText(stored, 1)).not.toThrow();
  });

  it('a stored result cannot write the share card', () => {
    const p = normalizeProfile({
      daily: {
        '2026-09-09': {
          key: '2026-09-09',
          moves: 'x\n\n>>> free coins at http://evil.example',
          elapsed: {}, shifts: 1, hints: 0, phantom: false,
          phantomsRecalled: 0, phantomsMissed: 0, xp: 1,
        },
      },
    });
    const text = shareText(p.daily['2026-09-09'], 1);
    expect(text).not.toContain('evil.example');
    expect(text.split('\n')).toHaveLength(3);
    // 2026-09-09 is a Wednesday, so it is a phantom day and the card says so
    // in both places: the label comes from the day, and now so does the ghost
    // section, whatever the record claims about itself.
    expect(text).toBe(
      'Sudokuoku Daily 2026-09-09 · Medium · Phantom day\n⏱ 0:00 · 0 moves · 1 shifts · 👻 0/0 · no hints\n🔥 1 day streak · +1 XP',
    );
  });

  it('changes nothing in a profile the app itself wrote', () => {
    // Every repair here rewrites a field, so the one thing that must hold is
    // that none of them touches a real record: the rules a daily is filed
    // with are the rules it was played under, by construction.
    let profile = emptyProfile();
    for (const key of ['2026-09-06', '2026-09-07', '2026-09-09']) {
      const settings = dailySettings(DEFAULT_SETTINGS, dailyConfig(key));
      const won = winGame(newGame(settings, dailySeed(key), { mode: 'daily', dailyKey: key }), 240);
      profile = recordGameWin(profile, won, parseDateKey(key)).profile;
    }
    expect(Object.keys(profile.daily)).toHaveLength(3);
    expect(profile.daily['2026-09-06'].difficulty).toBe('expert'); // a Sunday
    expect(profile.daily['2026-09-09'].phantom).toBe(true); // a Wednesday
    expect(normalizeProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
  });

  it('keeps a badge id it does not know, and counts only the ones it has', () => {
    const p = normalizeProfile({
      badges: {
        'first-win': '2026-09-06T00:00:00.000Z',
        'from-a-later-build': '2026-09-06T00:00:00.000Z',
        'streak-30': 7,
      },
    });
    // The profile is the only record of a badge there is, and this function is
    // what writes it back: an id from a build the player has downgraded from,
    // or one this project renames, is kept rather than deleted for good.
    expect(Object.keys(p.badges).sort()).toEqual(['first-win', 'from-a-later-build']);
    // The unlock time still has to be one.
    expect(p.badges['streak-30']).toBeUndefined();
    // What an unknown id must not do is count: "7 of 24" is over the badges
    // this build has, so nothing in the map can inflate it.
    expect(unlockedBadges(p).map((b) => b.id)).toEqual(['first-win']);
    expect(unlockedBadges(p).every((b) => BADGES.includes(b))).toBe(true);
    // An array is an object too, and its own keys are its indices - '0', '1'
    // - which would now go into the map as badge ids of their own.
    expect(normalizeProfile({ badges: ['first-win', 'streak-30'] }).badges).toEqual({});
  });

  it('counts in a profile are whole and never negative', () => {
    const p = normalizeProfile({
      xp: 'lots',
      totals: { won: '99', played: null, shifts: -5, dailiesCompleted: 2.9 },
      stats: { hard: { won: -3, played: 4, bestTime: -1, fewestShifts: 'none' } },
      bestStreak: -7,
      freezes: 99,
      frozenDays: { '2026-09-05': true, 'NaN-NaN-NaN': true },
    });
    expect(p.xp).toBe(0);
    // XP is the level bar and the level is a title on screen, so the clamp has
    // to hold over numbers too, not only over 'lots', which is 0 either way.
    expect(normalizeProfile({ xp: -500 }).xp).toBe(0);
    expect(normalizeProfile({ xp: 2.9 }).xp).toBe(2);
    expect(p.totals.won).toBe(0);
    expect(p.totals.played).toBe(0);
    expect(p.totals.shifts).toBe(0);
    expect(p.totals.dailiesCompleted).toBe(2);
    expect(p.stats.hard.won).toBe(0);
    expect(p.stats.hard.played).toBe(4);
    expect(p.stats.hard.bestTime).toBeNull();
    expect(p.stats.hard.fewestShifts).toBeNull();
    expect(p.bestStreak).toBe(0);
    expect(p.freezes).toBe(MAX_FREEZES);
    expect(Object.keys(p.frozenDays)).toEqual(['2026-09-05']);
    // And levels are computed from a number, not from whatever was stored.
    expect(levelInfo(p.xp).level).toBe(1);
  });
});
