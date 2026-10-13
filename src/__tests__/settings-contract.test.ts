import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_NAME, LICENCE, PRIVACY, PRIVACY_WEB, PRIVACY_WITH_ACCOUNT, SOURCE_URL, SUPPORTER_THANKS, TAGLINE, appVersion } from '../about';
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
      challenge: 'sudokuoku:challenge:v1',
      challengeCode: 'sudokuoku:challengeCode:v1',
      screen: 'sudokuoku:screen:v1',
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
    // ...and on the website, the line for a site with no sign-in, and the one
    // for a site with it, which says what signing in and paying hand over.
    expect(PRIVACY_WEB).toMatch(/^Nothing leaves your device/);
    expect(PRIVACY_WEB).not.toMatch(/network code/);
    expect(PRIVACY_WITH_ACCOUNT).toMatch(/^Nothing leaves your device unless you sign in or buy\. /);
    for (const fact of ['an account id and your email address', 'Stripe', "Stripe's customer id", 'what was bought']) {
      expect(PRIVACY_WITH_ACCOUNT).toContain(fact);
    }
    expect(SUPPORTER_THANKS).toBe(`Thank you for supporting ${APP_NAME}.`);
  });

  it('the privacy-policy author is told what the website keeps, as About says it', () => {
    // docs/store-listing.md is what a privacy policy will be written from: About's sentence and
    // it change together.
    const notes = fs.readFileSync(path.join(root, 'docs/store-listing.md'), 'utf8');
    const data = /^## Data notes for the privacy-policy author\n([\s\S]*)$/m.exec(notes)?.[1] ?? '';
    for (const fact of [
      'Nothing leaves the visitor\'s device for it unless they sign in or buy.',
      'Google tells the site an account id and the email address',
      'a payment goes through Stripe, which handles it',
      "The site keeps the account id, what was bought and Stripe's customer id, and the email address only in the sign-in session",
      "Delete account removes them, but for a count of the hour's Buy presses that names the account id and expires within two hours",
      'The iOS and Android apps have none of this',
    ]) {
      expect(data).toContain(fact);
    }
    for (const fact of ['an account id and your email address', "what was bought and Stripe's customer id"]) {
      expect(PRIVACY_WITH_ACCOUNT).toContain(fact);
    }
  });

  it('shows the configured version, and a placeholder that cannot pass for one', () => {
    expect(appVersion(app.version)).toBe(app.version);
    expect(app.version).toBe(pkg.version);
    expect(appVersion(undefined)).toBe('0.0.0');
    expect(appVersion('')).toBe('0.0.0');
    expect(appVersion(42)).toBe('0.0.0');
  });
});

/**
 * The other half of the contract lives in the components, and there is no
 * renderer in this repository to put it in front of: the screens are read as
 * text instead. What a screen reader is told on the web build is the case in
 * point — react-native-web maps no accessibilityState at all, so a control
 * that says nothing beside it says nothing at all, and every test here ran
 * green while it did. The rest of these are the other mutations that left
 * the suite green: a haptic the Vibration switch cannot gate, a confirmation
 * that does nothing on the web, pencil marks in a tone the palette test does
 * not hold to the board, and a reset that puts back more than the
 * preferences.
 */
describe('the screens', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  /** Every source file the app ships, by path; tests are not screens. */
  const sources = (): { file: string; text: string }[] => {
    const out: { file: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          out.push({ file: path.relative(root, full), text: fs.readFileSync(full, 'utf8') });
        }
      }
    };
    walk(path.join(root, 'src'));
    for (const name of ['App.tsx', 'index.ts']) {
      out.push({ file: name, text: fs.readFileSync(path.join(root, name), 'utf8') });
    }
    expect(out.length).toBeGreaterThan(10); // the walk found the app
    return out;
  };

  it('fires every haptic through haptics.ts, where the Vibration setting is', () => {
    for (const { file, text } of sources()) {
      if (file === path.join('src', 'haptics.ts')) continue;
      expect(text, `${file} reaches expo-haptics past the setting`).not.toMatch(/from 'expo-haptics'/);
    }
    // ...and the screen that owns the setting sets the flag the module reads,
    // or the switch gates nothing at all.
    expect(read('src/screens/GameScreen.tsx')).toMatch(/setHapticsEnabled\(state\.settings\.haptics\)/);
  });

  it('asks every confirmation through confirm.ts, where the web fallback is', () => {
    // react-native-web implements Alert as an empty stub, so a two-button
    // Alert on the web is a button that does nothing at all. The one notice
    // the app raises directly is a single message with no choice in it, and
    // it already falls back to window.alert on that platform.
    for (const { file, text } of sources()) {
      if (file === path.join('src', 'confirm.ts')) continue;
      const calls = [...text.matchAll(/Alert\.alert\(([\s\S]*?)\);/g)].map((m) => m[1]);
      const expected = file === path.join('src', 'screens', 'GameScreen.tsx') ? 1 : 0;
      expect(calls.length, `${file} raises an Alert of its own`).toBe(expected);
      for (const args of calls) {
        expect(args, `${file} confirms with a bare Alert.alert`).not.toContain('[');
      }
    }
  });

  it('draws pencil marks in the ink the palette test holds to the board', () => {
    // The palette pins given === text and holds it to AA on every cell fill;
    // what the marks are actually drawn in is here.
    expect(read('src/components/Board.tsx')).toMatch(/\bnote: \{[^}]*\bcolor: colors\.text,/);
  });

  it('resets exactly the preferences, in the words every app in the set uses', () => {
    const sheet = read('src/components/SettingsSheet.tsx');
    expect(sheet).toMatch(/title: 'Reset settings\?',/);
    expect(sheet).toMatch(/'This puts every preference back to its default\./);
    expect(sheet).toMatch(/cancelLabel: 'Cancel',\n\s*confirmLabel: 'Reset',/);
    // defaultShared() is SHARED_SETTING_KEYS and nothing else: a patch with a
    // rule or the intro flag in it would reset what is not a preference.
    expect(sheet).toMatch(/onConfirm: \(\) => onChange\(defaultShared\(\)\),/);
  });

  it('says which choice is the current one, on the web as well as on a device', () => {
    // The aria prop beside accessibilityState is the whole of what a browser
    // is told: an option with a role and no state is announced as "not
    // checked", the current one included.
    const segmented = read('src/components/ui/Segmented.tsx');
    expect(segmented).toMatch(/accessibilityRole="radiogroup" accessibilityLabel=\{title\}/);
    expect(segmented).toMatch(/accessibilityRole="radio"/);
    expect(segmented).toMatch(/accessibilityState=\{\{ selected: active, checked: active \}\}/);
    expect(segmented).toMatch(/aria-checked=\{active\}/);
    const sheet = read('src/components/SettingsSheet.tsx');
    expect(sheet).toMatch(/accessibilityRole="switch"/);
    expect(sheet).toMatch(/aria-checked=\{value\}/);
    expect((sheet.match(/aria-selected=\{active\}/g) ?? []).length).toBe(2); // presets, packs
  });

  it('draws the website’s account and support between Reset to defaults and About, and About’s lines from accountView', () => {
    const sheet = read('src/components/SettingsSheet.tsx');
    const at = (text: string) => {
      const i = sheet.indexOf(text);
      expect(i, text).toBeGreaterThan(-1);
      return i;
    };
    const order = [at('label="Reset to defaults"'), at('{view.account ? ('), at('{view.support ? ('), at('<Text style={styles.section}>About</Text>')];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sheet).toMatch(/<Text style=\{styles\.aboutText\}>\{view\.privacy\}<\/Text>/);
    expect(sheet).toMatch(/\{view\.thanks \? <Text style=\{styles\.thanks\}>\{view\.thanks\}<\/Text> : null\}/);
    expect(sheet).toMatch(/const view = accountView\(account\.state, Platform\.OS === 'web'\);/);
    // Deleting the account is confirmed like every other loss, through confirm.ts.
    expect(sheet).toMatch(/confirmAction\(\{\s*title: ACCOUNT_NOTES\.deleteTitle,/);
    expect(sheet).toMatch(/<PrimaryButton label=\{WORDS\.deleteAccount\}[^>]*onPress=\{onDeleteAccount\} \/>/);
    expect(sheet).toMatch(/onConfirm: \(\) => run\(account\.deleteAccount, setAccountNote\),/);
  });

  it('hands the source link to the browser as a link on the web, and to the OS on a device', () => {
    // react-native-web renders `href` as an <a>; without one the About link
    // exports as a <div role="link"> with nowhere to go.
    const sheet = read('src/components/SettingsSheet.tsx');
    expect(sheet).toMatch(/Platform\.OS === 'web'\n\s*\? \{ href: SOURCE_URL, hrefAttrs: \{ target: '_blank', rel: 'noreferrer' \} \}/);
    expect(sheet).toMatch(/Linking\.openURL\(SOURCE_URL\)/);
    expect(sheet).toMatch(/accessibilityRole="link"/);
  });
});
