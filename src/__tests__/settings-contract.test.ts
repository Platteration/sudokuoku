import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_NAME, LICENCE, PRIVACY, SOURCE_URL, TAGLINE, appVersion } from '../about';
import { DEFAULT_SETTINGS } from '../engine';
import { KEYS, LEGACY_KEYS } from '../storage';
import { SETTING_VALUES, SHARED_SETTING_KEYS } from '../utils/saved';

/**
 * The settings contract, pinned as literals. A renamed key orphans every
 * player's record silently, a dropped enum member sends whoever chose it back
 * to the default, and a row that stops being shared stops following the
 * player between games — none of which any other test would notice.
 */
describe('storage keys', () => {
  it('are exactly these, colons included', () => {
    // Namespaced and versioned already; the colon is grandfathered because a
    // rename for spelling would put every player through a migration.
    expect(KEYS).toEqual({
      game: 'sudokuoku:game:v1',
      daily: 'sudokuoku:daily:v1',
      profile: 'sudokuoku:profile:v1',
      settings: 'sudokuoku:settings:v1',
    });
    expect(LEGACY_KEYS).toEqual({
      stats: 'sudokuoku:stats:v1',
      helpSeen: 'sudokuoku:helpSeen:v1',
    });
    for (const key of [...Object.values(KEYS), ...Object.values(LEGACY_KEYS)]) {
      expect(key).toMatch(/^sudokuoku:[a-zA-Z]+:v\d+$/);
    }
  });
});

describe('settings rows', () => {
  it('are exactly these', () => {
    expect(Object.keys(DEFAULT_SETTINGS)).toEqual([
      'difficulty',
      'enabledShifts',
      'shiftEvery',
      'shiftsPerMove',
      'shiftPreview',
      'highlightConflicts',
      'showMistakes',
      'animateShifts',
      'theme',
      'themePack',
      'reduceMotion',
      'haptics',
      'phantomMode',
      'phantomTarget',
      'phantomEvery',
      'phantomLockMoves',
      'phantomMax',
      'phantomFadeMs',
      'phantomMarkers',
    ]);
  });

  it('share exactly these between the two games, and a reset puts back only these', () => {
    expect([...SHARED_SETTING_KEYS]).toEqual([
      'highlightConflicts',
      'showMistakes',
      'animateShifts',
      'theme',
      'themePack',
      'shiftPreview',
      'reduceMotion',
      'phantomMarkers',
      'phantomFadeMs',
      'haptics',
    ]);
  });

  it('start from these defaults', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(DEFAULT_SETTINGS.reduceMotion).toBe('system');
    expect(DEFAULT_SETTINGS.haptics).toBe(true);
    expect(DEFAULT_SETTINGS.themePack).toBe('classic');
  });
});

describe('enum tables', () => {
  it('hold exactly these values', () => {
    const members = Object.fromEntries(
      Object.entries(SETTING_VALUES).map(([key, table]) => [key, Object.keys(table)]),
    );
    expect(members).toEqual({
      difficulty: ['easy', 'medium', 'hard', 'expert'],
      shiftPreview: ['off', 'category', 'exact'],
      theme: ['system', 'light', 'dark'],
      phantomTarget: ['entries', 'givens', 'both'],
      reduceMotion: ['system', 'on', 'off'],
    });
  });
});

describe('the About card', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;

  it('says what the package says, and links the repository', () => {
    expect(APP_NAME).toBe(app.name);
    expect(TAGLINE).toBe(pkg.description);
    expect(TAGLINE).toBe(app.description);
    expect(LICENCE).toBe('MIT licence');
    expect(pkg.license).toBe('MIT');
    expect(fs.existsSync(path.join(root, 'LICENSE'))).toBe(true);
    expect(SOURCE_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/sudokuoku$/);
    // The privacy line is a claim about the code; appConfig.test.ts holds
    // the source to it (no network code, no URL but this one).
    expect(PRIVACY).toMatch(/^Nothing leaves your device/);
  });

  it('shows the configured version, and a placeholder that cannot pass for one', () => {
    expect(appVersion(app.version)).toBe(app.version);
    expect(app.version).toBe(pkg.version);
    expect(appVersion(undefined)).toBe('0.0.0');
    expect(appVersion('')).toBe('0.0.0');
    expect(appVersion(42)).toBe('0.0.0');
  });
});
