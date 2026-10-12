import { describe, expect, it, test } from 'vitest';
import { THEME_PACKS, isDarkScheme } from '../palette';

describe('which palette applies', () => {
  it('is the preference when one is stated', () => {
    for (const system of ['light', 'dark', null, undefined]) {
      expect(isDarkScheme('dark', system)).toBe(true);
      expect(isDarkScheme('light', system)).toBe(false);
    }
  });

  it('follows the system, and a system that states nothing means dark', () => {
    // React Native types the scheme as possibly null: the OS stated no
    // preference. Every sibling app resolves that to its own pre-provider
    // default, which is dark; this app's used to be the one exception.
    expect(isDarkScheme('system', 'light')).toBe(false);
    expect(isDarkScheme('system', 'dark')).toBe(true);
    expect(isDarkScheme('system', null)).toBe(true);
    expect(isDarkScheme('system', undefined)).toBe(true);
    expect(isDarkScheme('system', 'unspecified')).toBe(true);
  });
});

// The palettes as theme.tsx hands them to the screens (it re-exports these objects). The full
// table of pairings the app draws is palette.test.ts; this is the smaller set the light packs'
// contrast fix on the default branch was measured against, with selected digits at 3:1.
const WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return channels
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * (WEIGHTS[i] ?? 0), 0);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(THEME_PACKS)('$name readability', (pack) => {
  test.each(['light', 'dark'] as const)('%s text and digits contrast with their actual surfaces', (mode) => {
    const colors = pack[mode];
    const smallText: [string, string][] = [
      [colors.text, colors.background], [colors.text, colors.surface],
      [colors.textMuted, colors.background], [colors.textMuted, colors.surface],
      [colors.onPrimary, colors.primary], [colors.onAccent, colors.accent],
      [colors.phantom, colors.cellPhantom], [colors.onBanner, colors.shiftBanner],
      [colors.onBannerMuted, colors.shiftBanner],
    ];
    for (const [foreground, background] of smallText) {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const foreground of [colors.given, colors.entry]) {
      expect(contrast(foreground, colors.cellSelected)).toBeGreaterThanOrEqual(3);
    }
  });
});
