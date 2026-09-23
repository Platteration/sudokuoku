import { describe, expect, it } from 'vitest';
import { Colors, THEME_PACKS, lightColors } from '../palette';

/** sRGB relative luminance, per WCAG 2.1. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  expect(m, `not a six-digit hex colour: ${hex}`).not.toBeNull();
  const digits = m![1]!; // the pattern's one group, which every match fills
  const linear = (at: number) => {
    const c = parseInt(digits.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(0) + 0.7152 * linear(2) + 0.0722 * linear(4);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const schemes = ['light', 'dark'] as const;

/** The backgrounds a board cell can have; every digit and pencil mark is drawn on each of them. */
const CELL_BACKGROUNDS: (keyof Colors)[] = [
  'surface',
  'cellPeer',
  'cellSelected',
  'cellSameDigit',
  'cellConflict',
  'cellPhantom',
];

/**
 * Text pairings the app actually draws, as [foreground, background]. Read off
 * the components: `text`/`textMuted` on the screen and sheet background, on
 * cards and rows (`surface`), on the segmented track and preset icon
 * (`cellPeer`), on the daily note and badge rows (`accentSoft`) and on the XP
 * card (`primarySoft`); `onPrimary` on buttons and the done daily dot;
 * `primary` on stat values, active pack and preset names and the frozen dot;
 * `danger` on the reset button; `phantom` on the phantom line; the banner's
 * two tones; `onAccent` on the active control; and the board's three digit
 * colours (givens, entries, wrong or clashing entries) on every cell
 * background — pencil marks draw in `text`, which is also `given` in every
 * pack. `success` is only drawn as an icon, but is held to the same bar.
 */
const TEXT_PAIRS: [keyof Colors, keyof Colors][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'cellPeer'],
  ['text', 'accentSoft'],
  ['text', 'primarySoft'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['textMuted', 'cellPeer'],
  ['textMuted', 'accentSoft'],
  ['onPrimary', 'primary'],
  ['onPrimary', 'success'],
  ['primary', 'surface'],
  ['primary', 'background'],
  ['primary', 'primarySoft'],
  ['danger', 'surface'],
  ['danger', 'dangerSoft'],
  ['success', 'surface'],
  ['phantom', 'cellPhantom'],
  ['phantom', 'surface'],
  ['onBanner', 'shiftBanner'],
  ['onBannerMuted', 'shiftBanner'],
  ['onAccent', 'accent'],
  ...(['given', 'entry', 'danger'] as const).flatMap((digit) =>
    CELL_BACKGROUNDS.map((bg): [keyof Colors, keyof Colors] => [digit, bg]),
  ),
];

/**
 * 4.5:1 throughout. The board's given digits are bold and at least 18.7px on
 * a 330dp phone, and a few numerals (the number pad, the win sheet's stats,
 * the XP gain) are 20-25px bold, so those would qualify as large text at 3:1;
 * entries are weight 500 and under 24px on a phone, so they would not. None of
 * them needs the lower bar, so there is one.
 */
const AA = 4.5;

const colourKeys = (Object.keys(lightColors) as (keyof Colors)[]).filter((k) => k !== 'backdrop');

describe('palette', () => {
  it('names every pack once', () => {
    expect(THEME_PACKS.map((p) => p.id)).toEqual(['classic', 'paper', 'terminal', 'blueprint', 'sunset', 'contrast']);
  });

  it('defines every colour, as a six-digit hex, in both schemes of every pack', () => {
    for (const pack of THEME_PACKS) {
      for (const scheme of schemes) {
        const p = pack[scheme];
        for (const k of colourKeys) {
          expect(p[k], `${pack.id}/${scheme} ${k}`).toMatch(/^#[0-9a-f]{6}$/i);
        }
        expect(p.backdrop).toMatch(/^rgba\(/);
      }
    }
  });

  it('meets WCAG AA (4.5:1) for every text pairing in both schemes of every pack', () => {
    const failures: string[] = [];
    for (const pack of THEME_PACKS) {
      for (const scheme of schemes) {
        const p = pack[scheme];
        for (const [fg, bg] of TEXT_PAIRS) {
          const ratio = contrast(p[fg], p[bg]);
          if (ratio < AA) failures.push(`${pack.id}/${scheme} ${fg} on ${bg}: ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('draws givens and pencil marks in the same ink', () => {
    // The pencil marks are drawn in `text`; the pairings above cover them
    // through `given` only while the two stay one colour.
    for (const pack of THEME_PACKS) {
      for (const scheme of schemes) {
        expect(pack[scheme].given, `${pack.id}/${scheme}`).toBe(pack[scheme].text);
      }
    }
  });

  it('keeps surfaces and highlights distinguishable', () => {
    for (const pack of THEME_PACKS) {
      for (const scheme of schemes) {
        const p = pack[scheme];
        const where = `${pack.id}/${scheme}`;
        // A card is either a tint on the background or a bordered box on it:
        // the High contrast pack draws white on white and relies on `line`.
        const tinted = p.surface !== p.background;
        expect(tinted || contrast(p.line, p.surface) >= 3, `${where}: cards are invisible against the background`).toBe(true);
        expect(contrast(p.line, p.surface), `${where}: borders vanish on surfaces`).toBeGreaterThan(1.05);
        // The selected cell also carries a ring, but its fill must still read
        // against the peers around it.
        expect(contrast(p.cellSelected, p.cellPeer), `${where}: the selected cell melts into its peers`).toBeGreaterThan(1.05);
        expect(contrast(p.cellPeer, p.surface), `${where}: peers melt into plain cells`).toBeGreaterThan(1.02);
      }
    }
  });
});
