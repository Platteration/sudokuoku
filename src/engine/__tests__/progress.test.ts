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
  normalizeProfile,
  parseDateKey,
  profileStreak,
  recordGameStart,
  recordGameWin,
  shareText,
  shiftDateKey,
  todaysDailyInProgress,
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

describe('date keys', () => {
  it('formats and parses local dates', () => {
    const d = new Date(2026, 8, 6);
    expect(dateKey(d)).toBe('2026-09-06');
    expect(dateKey(parseDateKey('2026-09-06'))).toBe('2026-09-06');
    expect(shiftDateKey('2026-09-06', -1)).toBe('2026-09-05');
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateKey('2026-02-28', 1)).toBe('2026-03-01');
  });
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

  it('files a stored daily under the day it is filed under', () => {
    const p = normalizeProfile({
      daily: {
        '2026-09-07': { ...result('2026-09-07'), key: 'not-a-date', difficulty: 'impossible', phantom: 'yes' },
      },
    });
    const stored = p.daily['2026-09-07'];
    // dailyConfig is handed result.key by the share card, and a key that is
    // not a date used to take the button down with it.
    expect(stored.key).toBe('2026-09-07');
    expect(stored.difficulty).toBe(dailyConfig('2026-09-07').difficulty);
    expect(stored.phantom).toBe(dailyConfig('2026-09-07').phantom);
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
    expect(text).toBe(
      'Sudokuoku Daily 2026-09-09 · Medium · Phantom day\n⏱ 0:00 · 0 moves · 1 shifts · no hints\n🔥 1 day streak · +1 XP',
    );
  });

  it('keeps only badges the app has', () => {
    const p = normalizeProfile({
      badges: { 'first-win': '2026-09-06T00:00:00.000Z', 'not-a-badge': 'x', 'streak-30': 7 },
    });
    expect(Object.keys(p.badges)).toEqual(['first-win']);
    expect(Object.keys(p.badges).every((id) => BADGES.some((b) => b.id === id))).toBe(true);
    // An array is an object too, and the progress sheet counts what is in it.
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
