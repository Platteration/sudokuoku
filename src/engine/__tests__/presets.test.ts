import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, newGame, reduce } from '../game';
import { PRESETS, applyPreset, matchingPreset } from '../presets';
import { ALL_SHIFT_KINDS } from '../transforms';

const byId = (id: string) => PRESETS.find((p) => p.id === id)!;

describe('presets', () => {
  it('have unique ids and cover the named modes', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(PRESETS.map((p) => p.id)).toEqual(['zen', 'classic', 'phantom', 'blindfold', 'chaos']);
  });

  it('change only the rules, never appearance or assistance', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      theme: 'dark' as const,
      themePack: 'terminal',
      reduceMotion: true,
      showMistakes: true,
      difficulty: 'expert' as const,
      phantomFadeMs: 2000,
    };
    for (const preset of PRESETS) {
      const next = applyPreset(settings, preset);
      expect(next.theme).toBe('dark');
      expect(next.themePack).toBe('terminal');
      expect(next.reduceMotion).toBe(true);
      expect(next.showMistakes).toBe(true);
      expect(next.difficulty).toBe('expert');
      expect(next.phantomFadeMs).toBe(2000);
    }
  });

  it('zen stops the board moving and the digits fading', () => {
    const settings = applyPreset(DEFAULT_SETTINGS, byId('zen'));
    expect(settings.enabledShifts).toEqual([]);
    expect(settings.phantomMode).toBe(false);
    let s = newGame(settings, 5);
    for (let i = 0; i < 6; i++) {
      const q = s.values.findIndex((v) => v === 0);
      s = reduce(reduce(s, { type: 'select', pos: q }), { type: 'input', digit: s.solution[q] });
    }
    expect(s.shiftCount).toBe(0);
    expect(s.phantomCount).toBe(0);
    expect(s.tokens).toEqual(newGame(settings, 5).tokens);
  });

  it('chaos fires two shifts per move with every shift kind', () => {
    const settings = applyPreset(DEFAULT_SETTINGS, byId('chaos'));
    expect(settings.enabledShifts).toEqual(ALL_SHIFT_KINDS);
    let s = newGame(settings, 6);
    const q = s.values.findIndex((v) => v === 0);
    s = reduce(reduce(s, { type: 'select', pos: q }), { type: 'input', digit: 4 });
    expect(s.moves).toBe(1);
    expect(s.shiftCount).toBe(2);
  });

  it('blindfold keeps phantoms but hides the markers', () => {
    const settings = applyPreset(DEFAULT_SETTINGS, byId('blindfold'));
    expect(settings.phantomMode).toBe(true);
    expect(settings.phantomMarkers).toBe(false);
  });

  it('matchingPreset recognises its own rules and rejects a custom set', () => {
    for (const preset of PRESETS) {
      expect(matchingPreset(applyPreset(DEFAULT_SETTINGS, preset))?.id).toBe(preset.id);
    }
    // Shift kind order does not matter.
    const shuffled = {
      ...applyPreset(DEFAULT_SETTINGS, byId('classic')),
      enabledShifts: [...byId('classic').rules.enabledShifts].reverse(),
    };
    expect(matchingPreset(shuffled)?.id).toBe('classic');
    const custom = { ...applyPreset(DEFAULT_SETTINGS, byId('classic')), shiftEvery: 4 };
    expect(matchingPreset(custom)).toBeNull();
  });

  it('shiftsPerMove is clamped to a sane range', () => {
    let s = newGame({ ...DEFAULT_SETTINGS, shiftsPerMove: 99 }, 7);
    const q = s.values.findIndex((v) => v === 0);
    s = reduce(reduce(s, { type: 'select', pos: q }), { type: 'input', digit: 4 });
    expect(s.shiftCount).toBe(4);
    let z = newGame({ ...DEFAULT_SETTINGS, shiftsPerMove: 0 }, 7);
    const q2 = z.values.findIndex((v) => v === 0);
    z = reduce(reduce(z, { type: 'select', pos: q2 }), { type: 'input', digit: 4 });
    expect(z.shiftCount).toBe(1);
  });
});
