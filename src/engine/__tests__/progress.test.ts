import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, GameState, newGame, reduce } from '../game';
import {
  BADGES,
  DailyResult,
  MAX_FREEZES,
  applyStreakFreeze,
  currentStreak,
  grantMonthlyFreeze,
  refreshStreak,
  dailyConfig,
  dailySeed,
  dailySettings,
  dateKey,
  emptyProfile,
  levelInfo,
  normalizeProfile,
  parseDateKey,
  recordGameStart,
  recordGameWin,
  shareText,
  shiftDateKey,
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

  it('normalizes a profile saved before freezes existed', () => {
    const p = normalizeProfile({ xp: 10 });
    expect(p.freezes).toBe(0);
    expect(p.frozenDays).toEqual({});
    expect(p.lastFreezeGrant).toBeNull();
  });
});
