# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Native configuration

Native configuration is pinned by `src/__tests__/appConfig.test.ts`, which runs `expo
config --type introspect` and asserts the merged result, so app.json states every key
the test pins even at its default. SDK 57 dropped the top-level `splash` block and
`expo-splash-screen`'s plugin no-ops without props, so the splash lives only in
`plugins`; `userInterfaceStyle: automatic` reaches Android only through
`expo-system-ui`, which is a dependency for that reason. The app has no network code
(Share result is the system share sheet), so `android.blockedPermissions` strips
INTERNET, the storage/media set and SYSTEM_ALERT_WINDOW from the shipped build (VIBRATE,
for expo-haptics, is all that remains) and `plugins/withDebugInternet.js` (copied
verbatim from drawdraw) adds INTERNET back to the debug source set alone, which is how a
dev client still reaches Metro. `allowBackup` is explicitly true because the store is
the player's own record (two game slots and a profile), and a restore is untrusted JSON
that `src/utils/saved.ts` already guards. When adding a native module, run `npm test`:
the manifest walk fails on any permission the module declares that is neither used nor
blocked.
