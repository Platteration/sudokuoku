/**
 * What the app config asks the operating systems for, and what the native
 * projects it generates would carry. The config plugins fill in their own
 * defaults for anything app.json leaves out — a permission nothing here uses,
 * a backup policy nobody chose, a splash block the SDK stopped reading — and
 * the only place any of that shows up is a prebuild, which no other suite
 * runs. So app.json states every key this file pins, even at its default, and
 * the file and the test say the same thing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SOURCE_URL } from '../about';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

const appConfig = readJson('app.json').expo;
const pkg = readJson('package.json');
const eas = readJson('eas.json');

/**
 * The native projects a prebuild would generate: `expo config --type
 * introspect` runs the same plugin chain, so this is the merged result rather
 * than the app.json that feeds it. The template's own permissions and the
 * resources the plugins write only exist here.
 */
const introspected = JSON.parse(
  execFileSync(
    'node',
    [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
    }
  )
);
const mods = introspected._internal.modResults;
const manifest = mods.android.manifest.manifest;
const infoPlist = mods.ios.infoPlist;

/** One named item from an Android resources file the plugins wrote. */
const androidResource = (file: 'strings' | 'colors', kind: 'string' | 'color', name: string) =>
  (mods.android[file].resources[kind] ?? []).find((item: any) => item.$.name === name)?._;

/** The options an entry in `plugins` carries, or undefined when it is not listed. */
const pluginOptions = (name: string) => {
  const entry = (appConfig.plugins ?? []).find((p: unknown) =>
    (Array.isArray(p) ? p[0] : p) === name
  );
  if (entry === undefined) return undefined;
  return Array.isArray(entry) ? (entry[1] ?? {}) : {};
};

/**
 * Every AndroidManifest.xml under `dir`. `isDirectory()` is false for a
 * symlink, so a linked package — and any cycle through one — is left alone.
 */
const manifestsUnder = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...manifestsUnder(full));
    else if (entry.isFile() && entry.name === 'AndroidManifest.xml') out.push(full);
  }
  return out;
};

/** The app's own code: everything under src/ that is not a test, plus the entry files. */
const appSource = (): string => {
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        sources.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(path.join(root, 'src'));
  for (const file of ['App.tsx', 'index.ts']) {
    sources.push(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  expect(sources.length).toBeGreaterThan(10); // the walk found the app
  return sources.join('\n');
};

describe('splash screen', () => {
  const SPLASH = {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#f4f5f9',
  };

  it('is configured through the expo-splash-screen plugin, not the block SDK 57 dropped', () => {
    // SDK 57 removed the top-level `splash` key (only `web.splash` remains),
    // and expo-splash-screen@57's plugin reads props only: it no-ops without
    // them (plugin/build/withSplashScreen.js). A top-level block is silently
    // ignored — this app shipped one, with no plugin entry and the module not
    // even installed, so the splash it described never existed.
    expect(appConfig.splash).toBeUndefined();
    expect(pkg.dependencies['expo-splash-screen']).toBeDefined();
    const props = pluginOptions('expo-splash-screen');
    expect(props).toMatchObject(SPLASH);
    expect(props.imageWidth).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(root, SPLASH.image))).toBe(true);
  });

  it('reaches both native projects', () => {
    // The merged result rather than the props: this is what a prebuild writes.
    expect(androidResource('colors', 'color', 'splashscreen_background')).toBe(
      SPLASH.backgroundColor
    );
    expect(androidResource('strings', 'string', 'expo_splash_screen_resize_mode')).toBe(
      SPLASH.resizeMode
    );
    expect(infoPlist.UILaunchStoryboardName).toBe('SplashScreen');
  });
});

describe('appearance', () => {
  it('follows the system theme on both platforms', () => {
    // `userInterfaceStyle` on its own is an iOS setting. Android reads it
    // only through expo-system-ui (the schema says so, ExpoConfig.d.ts
    // 494-497), and without the module the app's System theme was a no-op
    // there — the REVIEW.md bug. The plugin autolinks, so the dependency is
    // the whole fix; the strings.xml key is the proof that it ran.
    expect(appConfig.userInterfaceStyle).toBe('automatic');
    expect(pkg.dependencies['expo-system-ui']).toBeDefined();
    expect(androidResource('strings', 'string', 'expo_system_ui_user_interface_style')).toBe(
      'automatic'
    );
    expect(infoPlist.UIUserInterfaceStyle).toBe('Automatic');
  });
});

describe('keys the SDK reads', () => {
  it('carries nothing SDK 57 stopped reading', () => {
    expect(introspected.sdkVersion).toMatch(/^57\./);
    // Gone from the schema: no reader in @expo/cli, config-plugins or
    // prebuild-config.
    expect(appConfig.newArchEnabled).toBeUndefined();
    // Gone too, and prebuild warns that Android 16 makes edge-to-edge
    // mandatory.
    expect(appConfig.android.edgeToEdgeEnabled).toBeUndefined();
  });

  it('states the keys it relies on, even at their defaults', () => {
    expect(appConfig.orientation).toBe('portrait');
    expect(appConfig.ios.supportsTablet).toBe(true);
    expect(appConfig.android.predictiveBackGestureEnabled).toBe(false);
    expect(appConfig.web.bundler).toBe('metro');
  });

  it('claims no URL scheme, because nothing here handles one', () => {
    expect(appConfig.scheme).toBeUndefined();
    // The About card hands one URL *out* to the system browser; nothing here
    // listens for a URL coming *in*, which is what a scheme would be for.
    expect(appSource()).not.toMatch(/getInitialURL|addEventListener\(\s*['"]url['"]|expo-linking|useURL\(/);
  });
});

describe('Android permissions', () => {
  /** The only permission this app has a use for. */
  const USED = ['android.permission.VIBRATE']; // expo-haptics

  /**
   * Blocked outright. The app opens no socket and touches no shared storage
   * (its whole store is AsyncStorage inside the app's own sandbox), and a game
   * has no reason to draw over other apps: SYSTEM_ALERT_WINDOW is one of the
   * template's "optional permissions, remove whatever you do not need", and
   * React Native's own debug-only manifest declares it again for the dev
   * menu, so a dev client loses nothing when main drops it.
   */
  const BLOCKED = [
    'android.permission.INTERNET',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_MEDIA_AUDIO',
    'android.permission.SYSTEM_ALERT_WINDOW',
  ];
  const INTERNET = 'android.permission.INTERNET';

  it('blocks the network and the storage set in app.json', () => {
    expect([...appConfig.android.blockedPermissions].sort()).toEqual([...BLOCKED].sort());
  });

  it('ships exactly the permissions it accounts for', () => {
    // The template adds permissions of its own that nothing here asked for,
    // and blockedPermissions is the only thing that takes one back out.
    const declared = manifest['uses-permission']
      .filter((p: any) => p.$['tools:node'] !== 'remove')
      .map((p: any) => p.$['android:name'])
      .sort();
    expect(declared).toEqual([...USED].sort());
  });

  it('removes every blocked permission from the merged manifest', () => {
    // A blocked permission is not merely left out: it is written with
    // tools:node="remove", which is what strips a library's own declaration
    // at build time. expo-file-system, a dependency of the expo package
    // itself, declares INTERNET and both legacy storage permissions, and the
    // template's main manifest declares SYSTEM_ALERT_WINDOW.
    for (const name of BLOCKED) {
      const entry = manifest['uses-permission'].find((p: any) => p.$['android:name'] === name);
      expect(entry, name).toBeDefined();
      expect(entry.$['tools:node'], name).toBe('remove');
    }
  });

  it('blocks every permission a bundled native module merges in', () => {
    // The generated manifest is only half of it: each native module ships an
    // AndroidManifest.xml that Gradle folds in at build time, which no plugin
    // option touches. Every manifest in the tree is read rather than the ones
    // at a guessed path inside a directory whose name starts with 'expo': a
    // scoped package is not a top-level directory name at all, react-native
    // keeps its own under ReactAndroid/src/debug, and the module someone adds
    // tomorrow is the one this is for.
    const files = manifestsUnder(path.join(root, 'node_modules'));
    const declaredBy = new Map<string, string[]>(); // permission -> the manifests declaring it
    for (const file of files) {
      const xml = fs.readFileSync(file, 'utf8');
      for (const m of xml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)) {
        declaredBy.set(m[1], [...(declaredBy.get(m[1]) ?? []), path.relative(root, file)]);
      }
    }

    // The scan found the module manifests, and reaches the three kinds a
    // name filter misses: a package that is not expo-*, a scoped one, and a
    // source set that is not src/main.
    const seen = files.map((f) => path.relative(path.join(root, 'node_modules'), f));
    expect(seen.length).toBeGreaterThan(10);
    expect(declaredBy.size).toBeGreaterThan(0);
    expect(seen.some((f) => f.startsWith('react-native/'))).toBe(true);
    expect(seen.some((f) => f.startsWith('@'))).toBe(true);
    expect(seen.some((f) => f.includes(`src${path.sep}debug${path.sep}`))).toBe(true);

    const accounted = [...USED, ...appConfig.android.blockedPermissions];
    const unblocked = [...declaredBy]
      .filter(([name]) => !accounted.includes(name))
      .map(([name, where]) => `${name} (${where.join(', ')})`);
    expect(unblocked).toEqual([]);
  });

  it('has no network code, which is why INTERNET can go', () => {
    // The reason for the block, checked against the source rather than
    // assumed. 'Share result' hands text to the system share sheet, and the
    // About card hands the repository URL to the system browser: both are
    // other processes with their own permission, and neither opens a socket
    // of this app's own. So the only URL in the source is that one, and the
    // only thing it is handed to is Linking.openURL.
    const source = appSource();
    // The APIs that open a socket, and the packages that open one for you:
    // expo-network reads the connection, expo-web-browser and
    // react-native-webview each embed a browser, and expo-updates fetches a
    // new bundle at launch. None of them is a dependency either.
    expect(source).not.toMatch(
      /\bfetch\(|axios|XMLHttpRequest|WebSocket|EventSource|openBrowserAsync|\bWebView\b/
    );
    expect(source).not.toMatch(/expo-updates|expo-network|expo-web-browser|react-native-webview/);
    for (const name of ['expo-updates', 'expo-network', 'expo-web-browser', 'react-native-webview']) {
      expect(pkg.dependencies[name], name).toBeUndefined();
    }
    // An image drawn from a `uri` is a socket the app opens without naming a
    // network API at all: the renderer fetches it. Every asset here is
    // bundled and reached with require(), so there is no uri to draw from.
    expect(source).not.toMatch(/\buri:/);
    const urls = [...source.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]);
    expect([...new Set(urls)]).toEqual([SOURCE_URL]);
    expect(source.match(/\bopenURL\([^)]*\)/g)).toEqual(['openURL(SOURCE_URL)']);
  });

  it('gives a development build the network back, in the debug source set only', async () => {
    // Blocking INTERNET outright would stop a dev client loading its bundle
    // from Metro. The manifest merger gives a build-type source set higher
    // priority than the main manifest, so the permission is added to
    // android/app/src/debug — the same split React Native's own template
    // uses for its debug-only SYSTEM_ALERT_WINDOW. The release variant never
    // reads that file.
    expect(appConfig.plugins).toContain('./plugins/withDebugInternet');
    const internet = manifest['uses-permission'].find((p: any) => p.$['android:name'] === INTERNET);
    expect(internet.$['tools:node']).toBe('remove'); // ...and main really does drop it

    const plugin = require('../../plugins/withDebugInternet');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudokuoku-prebuild-'));
    try {
      // What expo-template-bare-minimum@57.0.26 puts there, verbatim.
      const template = [
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
        '    xmlns:tools="http://schemas.android.com/tools">',
        '',
        '    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>',
        '',
        '    <application android:usesCleartextTraffic="true" tools:targetApi="28" tools:ignore="GoogleAppIndexingWarning" tools:replace="android:usesCleartextTraffic" />',
        '</manifest>',
        '',
      ].join('\n');
      const file = path.join(dir, plugin.DEBUG_MANIFEST);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, template);

      const config = plugin({ name: 'Sudokuoku', slug: 'sudokuoku' });
      expect(typeof config.mods.android.dangerous).toBe('function');
      await config.mods.android.dangerous({
        ...config,
        modRequest: { platformProjectRoot: dir },
      });

      const written = fs.readFileSync(file, 'utf8');
      expect(written).toMatch(/<uses-permission[^>]*android:name="android\.permission\.INTERNET"/);
      // ...without dropping what the template had there.
      expect(written).toContain('android.permission.SYSTEM_ALERT_WINDOW');
      expect(written).toContain('tools:replace="android:usesCleartextTraffic"');
      // ...and running it again changes nothing.
      expect(plugin.addInternetPermission(written)).toBe(written);
      // A project whose template wrote no debug manifest gets one.
      const fresh = path.join(dir, 'fresh');
      expect(fs.readFileSync(plugin.writeDebugManifest(fresh), 'utf8')).toContain(
        'android.permission.INTERNET'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Android backup', () => {
  it('keeps the player’s record in the backup set, and says so', () => {
    // allowBackup is true here on purpose, and written down rather than left
    // to @expo/config-plugins' default (which is also true — but a default
    // is not a decision). The store is the player's own record: two game
    // slots and a profile with stats, streaks and badges (src/storage.ts),
    // nothing sensitive and nothing recoverable from anywhere else. Losing
    // it on a phone migration would cost more than the backup exposes, and
    // the inbound side — a restore is untrusted JSON — is what
    // src/utils/saved.ts already guards.
    expect(appConfig.android.allowBackup).toBe(true);
    expect(manifest.application[0].$['android:allowBackup']).toBe('true');
  });
});

describe('adaptive icon', () => {
  it('has all three layers on disk', () => {
    // Android 13 draws the themed icon from monochromeImage and the
    // background from backgroundImage; with either missing the launcher falls
    // back to a flat colour or a generic glyph.
    const icon = appConfig.android.adaptiveIcon;
    for (const key of ['foregroundImage', 'backgroundImage', 'monochromeImage']) {
      expect(typeof icon[key], key).toBe('string');
      expect(fs.existsSync(path.join(root, icon[key])), key).toBe(true);
    }
    expect(icon.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('eas.json', () => {
  it('has the shared build profiles and sources versions remotely', () => {
    // With appVersionSource "remote", EAS owns the build number and
    // autoIncrement bumps it per production build; without it the CLI asks
    // interactively on the first build, which a CI or a scripted build cannot
    // answer.
    expect(eas.cli.version).toBe('>= 16.0.0');
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.development).toMatchObject({ developmentClient: true, distribution: 'internal' });
    expect(eas.build.preview).toMatchObject({ distribution: 'internal', android: { buildType: 'apk' } });
    expect(eas.build.production.autoIncrement).toBe(true);
  });
});
