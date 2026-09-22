# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Native configuration

Native configuration is pinned by `src/__tests__/appConfig.test.ts`, which runs `expo
config --type introspect` and asserts the merged result, so app.json states every key
the test pins even at its default. SDK 57 dropped the top-level `splash` block and
`expo-splash-screen`'s plugin no-ops without props, so the splash lives only in
`plugins`; `userInterfaceStyle: automatic` reaches Android only through
`expo-system-ui`, which is a dependency for that reason. The app has no network code
(Share result is the system share sheet) — the test reads the source for it: no socket
API, no image drawn from a `uri`, and none of the packages that open one for you
(expo-updates, expo-network, expo-web-browser, react-native-webview), leaving
`Linking.openURL(SOURCE_URL)` as the one URL the app hands out. So
`android.blockedPermissions` strips INTERNET, the storage/media set and
SYSTEM_ALERT_WINDOW from the shipped build (VIBRATE, for expo-haptics, is all that
remains) and `plugins/withDebugInternet.js` (copied
verbatim from drawdraw) adds INTERNET back to the debug source set alone, which is how a
dev client still reaches Metro. `allowBackup` is explicitly true because the store is
the player's own record (two game slots and a profile), and a restore is untrusted JSON
that `src/utils/saved.ts` already guards. When adding a native module, run `npm test`:
the manifest walk fails on any permission the module declares that is neither used nor
blocked.

## Settings

Preferences follow the shared settings contract (`CONVENTIONS.md`, "User-facing
settings"), pinned by `src/__tests__/settings-contract.test.ts`. Every stored key is in
`KEYS`/`LEGACY_KEYS` in `src/storage.ts`, spelled `sudokuoku:<record>:v1` — the colon is
grandfathered, a rename for spelling would migrate every player for nothing. The player's
own preferences (`SHARED_SETTING_KEYS` in `src/utils/saved.ts`: appearance, colour pack,
reduce motion, vibration, assistance) live in `sudokuoku:settings:v1` beside `seenIntro`,
which `loadSharedSettings` folds in from the old `helpSeen` key once; the game rules stay
in each game's own save. A launch that cannot read the record at all answers `seenIntro:
null`: the introduction stays shut for that launch and an unknown flag is never written,
because one transient read failure written down would hide the first-run help for good. `src/utils/saved.ts` is the validator: enum tables are
`Record<Union, true>` typed against `Settings`, lookups are own-property only, and the
boolean `reduceMotion` older builds stored is read there (`true` → `'on'`, `false` →
`'system'`). Reduce motion is three-way and `useReduceMotion` in `src/motion.ts` resolves
`'system'` against the device (a rejected native call or a page without `matchMedia` means
no preference); vibration is gated by the module flag in `src/haptics.ts`; every
confirmation goes through `src/confirm.ts`, because react-native-web's `Alert.alert` is a
no-op. Reset to defaults is confirmed and puts back `SHARED_SETTING_KEYS` only, keeping
`seenIntro`. The About card's text is in `src/about.ts` and its version comes from
`expo-constants` (`Constants.expoConfig.version`, so app.json); its source link is the one
URL in the app, handed to the system browser through `Linking.openURL`, which
`appConfig.test.ts` pins along with the absence of any network code. The palettes are in
`src/palette.ts`, free of React Native so `palette.test.ts` can hold every pack to WCAG AA;
`theme.tsx` re-exports them and resolves a null system scheme to dark.
