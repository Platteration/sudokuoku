import { describe, expect, test, vi } from 'vitest';
import { THEME_PACKS, type Colors } from '../theme';

vi.mock('react-native', () => ({ useColorScheme: () => 'light' }));

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return channels.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(THEME_PACKS)('$name readability', (pack) => {
  test.each(['light', 'dark'] as const)('%s text and digits contrast with their actual surfaces', (mode) => {
    const colors = pack[mode];
    const onAccent = (colors as Colors & { onAccent?: string }).onAccent ?? colors.onPrimary;
    const smallText: [string, string][] = [
      [colors.text, colors.background], [colors.text, colors.surface],
      [colors.textMuted, colors.background], [colors.textMuted, colors.surface],
      [colors.onPrimary, colors.primary], [onAccent, colors.accent],
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
