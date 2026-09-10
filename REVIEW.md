# Sudokuoku — security & upgrade review (2026-09-09)

Two independent reviewers read every first-party file in this repository; a third then re-read each security or bug claim against the code and tried to refute it. Only claims that survived that check are listed as findings; the ones that did not are recorded at the end so they are not re-raised.

## Status — what has been fixed

All of the following are fixed on `claude/repo-review-security-baiyud`, each with a regression test that was checked by reverting the fix.

**First pass** — every critical and high finding, plus the medium ones that were quick:

`BUG-1`, `MISS-1`

**Second pass** — the remaining medium findings and the low-severity ones that were trivial or small:

`BUG-4`, `BUG-5`, `BUG-6`, `BUG-7`, `MISS-3`, `MISS-4`, `BUG-2`, `BUG-3`

Deliberately not done: `CI-1`, `MISS-2`. Each was either already covered by an earlier pass, or judged churn or too risky to make without a device or a measurement. The reasoning is in the commit that touched it.

An independent reviewer then read each commit and tried to find what was wrong with it, and a second reviewer tried to refute every objection raised. What survived that was fixed in a follow-up commit.

Repository hardening applied here as well: every GitHub Action is pinned to a commit rather than a floating tag, each workflow declares a least-privilege `permissions` block, and a Dependabot config, a licence and a security policy are in place.

The rest of this document is the review as written. Fixed items are left in place so the reasoning behind each change stays with it.

## Summary

Sudokuoku is a single-screen Expo SDK 57 / React Native 0.86 / React 19.2 Sudoku variant (~7,100 lines of TypeScript) whose board is permuted by a Sudoku symmetry after every move, with an optional 'phantom' memory mode, a seeded daily challenge, streaks with freezes, XP, badges, six colour packs and deliberate screen-reader support. The engine (generator, solver, transforms, reducer, progression) is pure, well commented and covered by seven vitest suites; the UI is a thin reducer-driven layer over it. It is a feature-complete pre-release (v1.0.0, fourteen commits over two days): the platform is current (new architecture, no deprecated expo modules), but the LICENSE is still Expo's template, EAS is not linked to a project, there is no scheme, lint, Dependabot or component test, and the web export has three no-op Alert paths. Headline fixes: set userInterfaceStyle to automatic (the System theme cannot go dark on device today), finish store readiness, add ESLint/Prettier/Dependabot and a hardened CI, stop the one-second timer tick from re-rendering the ~250-view board, slim the 200-snapshot history that is serialised on every move, and consolidate the rule defaults that are currently defined in three modules.

## Attack surface

Sudokuoku is an offline, single-player Expo/React Native app (iOS, Android, static web preview) with no server, no accounts, no network calls of any kind (grep finds no fetch/XMLHttpRequest/WebSocket/Linking), no WebView, no OTA updates (expo-updates is not a dependency) and no URL scheme. The only inputs are taps and the JSON the app itself previously wrote to AsyncStorage (two game states, a profile, a help-seen flag); the only output that leaves the device is a plain-text result card handed to the OS share sheet. Stored data is non-sensitive game progress inside the app sandbox. All rendering goes through React Native Text/View, so there is no HTML injection path even on the web build. The realistic threat model is therefore integrity of the player's own game/stat records, loss or corruption of local saves, resource use on the JS thread, and the toolchain supply chain (598 lockfile packages, GitHub Actions CI, EAS builds).

## Already done well

- Every shift is a genuine Sudoku symmetry: band/stack cycles, band/stack permutations, transpose-based rotations and mirrors, box-slide (row cycle on every band + column cycle on every stack) and digit relabel. src/engine/transforms.ts:123-244 and src/engine/__tests__/transforms.test.ts:42-72,137-147 (300-shift random sequence must stay uniquely solvable). An independent re-check of all 39 concrete variants against 12 generated puzzles found zero uniqueness or clue/solution mismatches, so the README claim holds.
- The game is a pure reducer over immutable state with seeded PRNG streams keyed on seed and move count (src/engine/game.ts:226-233), which makes games reproducible, keeps the daily identical for everyone (src/engine/progress.ts:32-39) and lets the 'exact' shift preview read the same stream the move will use (src/engine/game.ts:509-516, tested in game.test.ts:344-356).
- Persistence is defensive: JSON.parse is wrapped, saves are shape-checked before use, normalize() fills every field added since the first release (mode, dailyKey, elapsed, phantoms, counters, history) and both legacy formats ({state, elapsed} wrapper and stats-only store) are migrated (src/storage.ts:10-61, 84-100; src/engine/progress.ts:343-363).
- Hints cannot farm rewards: hintsUsed is deliberately excluded from undo snapshots (src/engine/game.ts:206-223), a hinted phantom scores a miss (game.ts:256-273) and skill badges require <= CLEAN_HINT_LIMIT hints (progress.ts:252-256), all covered by tests (progress.test.ts:275-337, phantom.test.ts:225-260).
- Phantom fairness guards are implemented and tested: a phantom never removes the last playable cell and locks release if a move leaves none (src/engine/game.ts:287-294, 311-315; phantom.test.ts:198-212). Undo restores faded digits (phantom.test.ts:184-196).
- Resource hygiene is good: the timer interval and AppState subscription are cleaned up (src/screens/GameScreen.tsx:216-228), the demo interval stops when the sheet closes (src/components/ShiftDemo.tsx:88-92), phantom fade Animated.Values are garbage-collected (src/components/Board.tsx:98), animations use the native driver, and haptics are skipped on web with rejected promises caught (GameScreen.tsx:94-103).
- Supply chain basics are right: package-lock.json is lockfileVersion 3 with integrity hashes for all packages and registry-only sources, CI runs `npm ci`, `tsc --noEmit`, vitest and an Android/web Metro export on every push (.github/workflows/ci.yml:17-23). Only esbuild/fsevents carry install scripts.
- Nothing sensitive is committed and .gitignore excludes signing material (*.jks, *.p8, *.p12, *.key, *.mobileprovision, *.pem) and local env files (.gitignore:15-19,31,34).
- The puzzle generator is cheap enough to run synchronously (measured <= 7 ms for an expert puzzle on JSC, src/engine/sudoku.ts:197-214), so 'New game' cannot freeze the UI.
- Accessibility is taken seriously: every cell has a content+position label and shifts/phantoms are announced (src/components/Board.tsx:179-180, src/screens/GameScreen.tsx:250-276, src/utils/describe.ts).

## Findings (14)

| # | Severity | Category | Title | Where | Effort | Status |
|---|---|---|---|---|---|---|
| BUG-1 | Medium | bug | Daily challenge rules can be rewritten mid-game through the Presets panel | `src/components/SettingsSheet.tsx:139` | small | confirmed |
| MISS-1 | Medium | bug | Notes written into a phantom cell after its lock expires are stored but never drawn | `src/components/Board.tsx:263` | small | found by second reviewer |
| BUG-2 | Low | bug | app.json pins the iOS app to light appearance, so the default 'System' theme never follows dark mode | `app.json:8` | trivial | confirmed |
| BUG-3 | Low | bug | Progress sheet computes the streak without streak freezes, so it disagrees with the Daily sheet and the share card | `src/components/ProgressSheet.tsx:142` | trivial | confirmed |
| BUG-4 | Low | bug | Shift preview, banner and screen-reader announcement describe only one of the shifts when shiftsPerMove > 1 | `src/engine/game.ts:515` | small | confirmed |
| BUG-5 | Low | bug | Appearance/assist settings changed while the daily is on screen are lost after an app restart | `src/screens/GameScreen.tsx:314` | small | confirmed |
| BUG-6 | Low | reliability | The whole 200-step undo history (0.4-0.55 MB) is serialised to AsyncStorage on every move and every 10 seconds | `src/screens/GameScreen.tsx:238` | small | confirmed |
| BUG-7 | Low | bug | On the web build, confirmation dialogs and the share fallback are silent no-ops | `src/screens/GameScreen.tsx:364` | small | confirmed |
| CI-1 | Low | ci-cd | GitHub Actions are tag-pinned, the workflow declares no permissions, and there is no Dependabot | `.github/workflows/ci.yml:12` | trivial | confirmed |
| MISS-2 | Low | bug | The board's ghost marker uses its own lock test, so force-unlocked phantoms still show a countdown | `src/components/Board.tsx:249` | trivial | found by second reviewer |
| MISS-3 | Low | bug | Today's daily is unreachable if the app is left open past midnight | `src/screens/GameScreen.tsx:297` | small | found by second reviewer |
| MISS-4 | Low | reliability | Save validation is shallow enough that a corrupt save can wedge the app on every launch | `src/storage.ts:10` | small | found by second reviewer |
| SC-1 | Info | supply-chain | npm audit: 10 moderate advisories, all transitive build-time toolchain (uuid <11.1.1 via xcode in @expo/config-plugins) | `package-lock.json` | trivial | confirmed |
| CFG-1 | Info | ci-cd | eas.json development profile requests a dev client that is not installed and no URL scheme is configured | `eas.json:7` | trivial | confirmed |

### BUG-1 · Daily challenge rules can be rewritten mid-game through the Presets panel

**Severity:** Medium · **Category:** bug · **Effort:** small · **Where:** `src/components/SettingsSheet.tsx:139`

The settings sheet hides the individual rule controls while a daily is on screen and tells the player the rules are fixed, but the Presets block sits above the `daily ? null : (...)` guard and stays tappable. `onChange(preset.rules)` dispatches `updateSettings`, and the reducer merges any patch regardless of `state.mode`. Tapping 'Zen' during a daily therefore sets enabledShifts to [] and phantomMode to false: the shared daily becomes a plain Sudoku with no shifts and no phantoms, is still recorded as that day's daily (with phantom:false in the result), earns the 1.5x daily XP multiplier, extends the streak and can unlock badges such as Quick Hands. Verified by running the engine: a Wednesday phantom daily won after applying Zen ends with 0 shifts, 0 phantoms, a recorded DailyResult, +150 XP and the first-win/speed/no-hints/daily-first badges. For a game whose daily is meant to be identical for everyone and whose result card is shared, this undermines the one feature that is comparative.

Evidence:

```
src/components/SettingsSheet.tsx:139 `onPress={() => onChange(preset.rules)}` (inside the Presets map at 134-160, before the `{daily ? null : (` guard at 171)
src/screens/GameScreen.tsx:485 `onChange={(patch) => send({ type: 'updateSettings', settings: patch })}`
src/engine/game.ts:426-427 `case 'updateSettings': return { ...state, settings: { ...state.settings, ...action.settings } };`
```

**Recommendation.** The reducer fix is right (drop RULE_KEYS from the patch when state.mode === 'daily') and moving the Presets block inside the `daily ? null : (...)` branch is right. Add one more guard while you are there: since `updateSettings` is not snapshotted, an accidental rule change is unrecoverable in any mode, so consider including `settings` in `Snapshot` or confirming destructive preset taps mid-game.

### MISS-1 · Notes written into a phantom cell after its lock expires are stored but never drawn

**Severity:** Medium · **Category:** bug · **Effort:** small · **Where:** `src/components/Board.tsx:263`

A phantom record deliberately lingers after `unlockAtMove` so the game can score the recall when the cell is refilled (game.ts:99-104, 297-304). While it lingers the cell is empty and fully playable: `input` in notes mode only refuses given cells, locked cells and non-empty cells (game.ts:444-454), so pencil marks are accepted and stored, and they permute correctly through every shift. But the token renderer tests `phantom && fade` first, and that branch has no notes case, so the notes branch at line 306 is unreachable for any cell holding a phantom record. The player pencils candidates into the cell they are trying to recall - the single most natural action in phantom mode - and nothing appears. `describeCell` uses `isLocked`, so a screen reader correctly reads 'empty, noted 3, 5 and 7' for a cell that looks blank, meaning sighted and VoiceOver users are told different things about the same cell.

Evidence:

```
src/components/Board.tsx:263 `{phantom && fade ? (` ... :293 `) : value !== 0 ? (` ... :306 `) : note !== 0 ? (`  - the phantom branch wins whenever `phantoms[pos] !== null`, including after the lock expires
src/engine/game.ts:447-454 `if (isLocked(state, p)) return state;\n      const d = action.digit;\n      if (d < 1 || d > 9) return state;\n      if (state.notesMode) {\n        if (state.values[p] !== 0) return state;\n        const notes = state.notes.slice();\n        notes[p] ^= 1 << d;`
src/engine/game.ts:236-239 `export function isLocked(state, pos) { const ph = state.phantoms[pos]; return ph !== null && !ph.unlocked && state.moves < ph.unlockAtMove; }`
src/utils/describe.ts:26-27 `const notes = listNotes(state.notes[pos]);\n  if (notes) return `${where}, empty, noted ${notes}`;`
```

**Recommendation.** Only take the phantom branch while the digit is still visible or the cell is still locked, e.g. `const showPhantom = phantom !== null && (isLocked(state, pos) || fadeStillRunning)`, and otherwise fall through to the value/notes branches. Simplest fix: render the phantom digit and marker as an overlay and let the value/notes branch run independently.

### BUG-2 · app.json pins the iOS app to light appearance, so the default 'System' theme never follows dark mode

**Severity:** Low · **Category:** bug · **Effort:** trivial · **Where:** `app.json:8`

`"userInterfaceStyle": "light"` makes Expo write `UIUserInterfaceStyle = Light` into Info.plist (and applies the same override in Expo Go), which forces `useColorScheme()` to return 'light'. The app's theme preference defaults to 'system' (src/engine/game.ts:71) and resolves dark only via `scheme === 'dark'` (src/theme.tsx:782), so on iOS every user who leaves the default gets the light palette even with the phone in dark mode; the README advertises a system/light/dark setting and six dark palettes. Android without expo-system-ui ignores the key and happens to work, giving inconsistent behaviour across platforms. The splash background is also light-only.

Evidence:

```
app.json:8 `"userInterfaceStyle": "light",`
src/theme.tsx:781-782 `const scheme = useColorScheme(); const isDark = preference === 'dark' || (preference === 'system' && scheme === 'dark');`
src/engine/game.ts:71 `theme: 'system',`
```

**Recommendation.** Set `"userInterfaceStyle": "automatic"` in app.json and add `expo-system-ui` so Android honours the same setting; optionally add `"splash": { "dark": { "backgroundColor": "#0f1117" } }` for a matching dark splash. Then `useColorScheme()` reports the real system scheme and the existing ThemeProvider logic works unchanged.

### BUG-3 · Progress sheet computes the streak without streak freezes, so it disagrees with the Daily sheet and the share card

**Severity:** Low · **Category:** bug · **Effort:** trivial · **Where:** `src/components/ProgressSheet.tsx:142`

`currentStreak` takes an optional `frozen` map that makes a freeze-covered day count. DailySheet, shareDaily and recordGameWin all pass `profile.frozenDays`, but ProgressSheet calls `currentStreak(profile.daily, todayKey)` with the default `{}`. After a freeze has rescued a missed day the Daily sheet shows the rescued streak (e.g. 5) while the Progress sheet's 'Streak' cell shows 0 or 1 for the same profile, which looks like lost progress to the player.

Evidence:

```
src/components/ProgressSheet.tsx:142 `const streak = currentStreak(profile.daily, todayKey);`
src/components/DailySheet.tsx:44 `const streak = currentStreak(p.profile.daily, p.todayKey, p.profile.frozenDays);`
src/screens/GameScreen.tsx:373 `currentStreak(profile.daily, todayKey, profile.frozenDays)`
```

**Recommendation.** Pass the freeze map: `currentStreak(profile.daily, todayKey, profile.frozenDays)`. Consider making `frozen` a required parameter of `currentStreak` so the compiler catches the next omission.

### BUG-4 · Shift preview, banner and screen-reader announcement describe only one of the shifts when shiftsPerMove > 1

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `src/engine/game.ts:515`

`afterMove` fires up to `shiftsPerMove` shifts from one RNG stream (Chaos preset = 2), but `nextShift` draws a single shift, so the 'Exact'/'Category' preview names only the first one; `lastShift` keeps only the final shift, so the banner and the `announceForAccessibility` text describe only the last one. The player is told 'Next: Board rotated clockwise', then sees the board rotate and the bottom band slide, and the banner reports only the slide. Verified with the engine: seed 1 preview 'Board rotated clockwise', banner 'Rows 7-9 slid down 1', 2 shifts fired. This defeats the purpose of the preview assist and hides half of each move from screen-reader users, who are explicitly catered for.

Evidence:

```
src/engine/game.ts:402-407 `const count = Math.max(1, Math.min(4, s.settings.shiftsPerMove)); for (let i = 0; i < count; i++) { const shift = randomShift(rng, s.settings.enabledShifts); ... s = applyShift(s, shift); }`
src/engine/game.ts:514-515 `const rng = createRng(...); return randomShift(rng, state.settings.enabledShifts);`
src/components/ShiftBanner.tsx:384-386 `preview === 'exact' ? next.description : CATEGORY_LABEL[...]`
src/screens/GameScreen.tsx:253-256 `if (state.lastShift) { AccessibilityInfo.announceForAccessibility(describeShift(state.lastShift.description, state.selected)); }`
```

**Recommendation.** Return the whole move: `nextShifts(state): Shift[]` that draws `count` shifts from the same seeded rng, and record `lastShifts: ShiftEvent[]` (or a joined description such as 'Board rotated clockwise, then rows 7-9 slid down 1') in `applyShift`/`afterMove`. Use the joined text in ShiftBanner, the preview and the accessibility announcement, and extend the 'shift preview' test to a shiftsPerMove: 2 case.

### BUG-5 · Appearance/assist settings changed while the daily is on screen are lost after an app restart

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `src/screens/GameScreen.tsx:314`

Settings live inside each game's state, and the 'shared' keys (theme, colour pack, reduce motion, shift preview, conflict/mistake highlighting, phantom markers, fade speed) are copied from the on-screen game to the other game only at switch time. On launch the reducer is always seeded with the free game (`useReducer(reduce, initial.free)`), so if the player changes the theme while playing the daily and then closes the app, the next launch shows the free game's old theme, and the very next switch to the daily overwrites the daily's newer values with the free game's stale ones (`{ ...next.settings, ...shared }`). The change simply disappears, which reads as a broken settings screen.

Evidence:

```
src/screens/GameScreen.tsx:164 `const [state, dispatch] = useReducer(reduce, initial.free);`
src/screens/GameScreen.tsx:307 `const shared = pickShared(state.settings);`
src/screens/GameScreen.tsx:314 `next = { ...next, settings: { ...next.settings, ...shared } };`
src/screens/GameScreen.tsx:116-118 `if (savedFree && savedFree.status === 'playing') { free = savedFree; }`
```

**Recommendation.** Store the shared settings once, outside the game states: add `sudokuoku:settings:v1` in src/storage.ts, write it from the `updateSettings` path (`saveSharedSettings(pickShared(state.settings))`), and on load overlay it onto both `free.settings` and `daily.settings` before `setLoaded`. Then `switchTo` no longer needs to copy settings between games.

### BUG-6 · The whole 200-step undo history (0.4-0.55 MB) is serialised to AsyncStorage on every move and every 10 seconds

**Severity:** Low · **Category:** reliability · **Effort:** small · **Where:** `src/screens/GameScreen.tsx:238`

Each history snapshot carries five 81-element arrays, an 81-slot phantoms array and a ShiftEvent whose `dest` is another 81-entry permutation, and MAX_HISTORY keeps 200 of them. Measured with the real engine after 500 moves: 418 KB per save with default settings and 553 KB with the Chaos preset, 99% of it history. The persist effect runs `JSON.stringify` and `AsyncStorage.setItem` on every board change and again every ten timer ticks, so a long game costs ~0.5 MB of JSON work on the JS thread per tap plus a 0.5 MB SQLite/file write, at the same moment the shift animation starts. It is still under Android's 2 MB CursorWindow read limit and the 6 MB default AsyncStorage database (two games worst case ~1.1 MB), but there is no headroom: raising MAX_HISTORY or adding a field to Snapshot would make saves fail silently (saveState swallows errors) or loads return null, wiping the game in progress.

Evidence:

```
src/engine/game.ts:164 `const MAX_HISTORY = 200;`
src/engine/game.ts:387 `history: [...prev.history.slice(-(MAX_HISTORY - 1)), snapshot(prev)],`
src/screens/GameScreen.tsx:238-245 `useEffect(() => { persist(state); }, [state.version, state.seed, state.settings, state.status, state.mode]); useEffect(() => { if (state.elapsed > 0 && state.elapsed % 10 === 0) persist(state); }, [state.elapsed]);`
src/storage.ts:65 `await AsyncStorage.setItem(key, JSON.stringify(state));`
```

**Recommendation.** Persist a bounded history: `saveState(key, { ...state, history: state.history.slice(-20) })` (undo depth on disk of 20 is plenty across a restart), store `lastShift` as `{ kind, params, description }` and rebuild `dest` on load instead of serialising the 81-entry permutation, and debounce the timer-driven save (or write only `elapsed` under a tiny separate key). Add a test that a saved state stays under a fixed byte budget.

### BUG-7 · On the web build, confirmation dialogs and the share fallback are silent no-ops

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `src/screens/GameScreen.tsx:364`

react-native-web implements `Alert.alert` as an empty stub. The app relies on it for 'Start a new free game?' (so the New game button does nothing on web once a game has a move in it), for 'Reset progress?' (reset never happens on web) and as the fallback when `Share.share` rejects, which it does in every browser without `navigator.share` (desktop Chrome/Firefox), so the share button appears dead. README positions web as a preview target, so severity is low, but the failures are silent rather than degraded.

Evidence:

```
src/screens/GameScreen.tsx:364 `Alert.alert('Start a new free game?', 'Your current free game will be lost.', [`
src/screens/GameScreen.tsx:507 `Alert.alert('Reset progress?', ...`
src/screens/GameScreen.tsx:549-551 `await Share.share({ message }); } catch { Alert.alert('Your result', message); }`
```

**Recommendation.** Wrap confirmations in a small helper: `if (Platform.OS === 'web') { if (window.confirm(title + '\n' + message)) onConfirm(); } else Alert.alert(...)`, or reuse the existing Sheet component as an in-app confirm dialog on all platforms. For sharing on web, fall back to `navigator.clipboard.writeText(message)` and show a 'Copied' toast.

### CI-1 · GitHub Actions are tag-pinned, the workflow declares no permissions, and there is no Dependabot

**Severity:** Low · **Category:** ci-cd · **Effort:** trivial · **Where:** `.github/workflows/ci.yml:12`

`actions/checkout@v4` and `actions/setup-node@v4` float on mutable tags, so a compromised or force-moved tag runs arbitrary code in CI with the default GITHUB_TOKEN. The workflow sets no `permissions:` block, so the token gets the repository default (often contents: write), and it also runs for `pull_request` events. No secrets are used and nothing is published from CI, so the blast radius today is the CI run itself and the token, which keeps this low. There is no Dependabot/Renovate configuration, so neither the actions nor the 598 npm packages get automated update PRs, and no SECURITY.md.

Evidence:

```
.github/workflows/ci.yml:12-13 `- uses: actions/checkout@v4` / `- uses: actions/setup-node@v4`
.github/workflows/ci.yml:3-6 `on: push: branches: ['**'] pull_request:` (no `permissions:` key anywhere in the file)
```

**Recommendation.** Pin both actions to full commit SHAs with a version comment (e.g. `actions/checkout@<sha> # v4.2.2`), add `permissions: contents: read` at the top of the workflow, and add `.github/dependabot.yml` with `package-ecosystem: github-actions` and `npm` (weekly, grouped) so the pins and the Expo toolchain get bumped automatically.

### MISS-2 · The board's ghost marker uses its own lock test, so force-unlocked phantoms still show a countdown

**Severity:** Low · **Category:** bug · **Effort:** trivial · **Where:** `src/components/Board.tsx:249`

Board recomputes lockedness locally as `phantom !== null && moves < phantom.unlockAtMove`, dropping the `!ph.unlocked` term that the engine's `isLocked` carries. `ensurePlayable` sets `unlocked: true` on every phantom, without touching `unlockAtMove`, whenever a move would otherwise leave no playable cell (game.ts:287-294) - the fairness escape hatch the README advertises. After it fires, the cell tint (line 154, which does call isLocked), the number pad's `selectedLocked` gate (GameScreen.tsx:383) and the accessibility label all treat the cell as playable, while the marker layer keeps drawing the ghost and a positive 'moves left' count on it. The player is told a cell is locked for N more moves when it is not.

Evidence:

```
src/components/Board.tsx:249 `const locked = phantom !== null && moves < phantom.unlockAtMove;`
src/components/Board.tsx:279-289 `{settings.phantomMarkers && locked ? (... <Text ...>{phantom.unlockAtMove - moves}</Text> ...)`
src/components/Board.tsx:154 `if (settings.phantomMarkers && isLocked(state, pos)) return colors.cellPhantom;`
src/engine/game.ts:287-294 `function ensurePlayable(state) { if (playableEmptyCells(state) > 0) return state; if (lockedPhantomCount(state) === 0) return state; return { ...state, phantoms: state.phantoms.map((ph) => (ph === null ? null : { ...ph, unlocked: true })) }; }`
src/engine/game.ts:236-239 `isLocked` includes `!ph.unlocked`
```

**Recommendation.** Use the engine helper: `const locked = isLocked(state, pos);` - it is already imported in this file (line 10). Then the marker, the tint and the accessibility state cannot drift apart.

### MISS-3 · Today's daily is unreachable if the app is left open past midnight

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `src/screens/GameScreen.tsx:297`

`todayKey` is recomputed on every render and the one-second tick re-renders continuously, so at local midnight it rolls over while the app is open. `switchTo` bails out on the mode alone, without comparing `state.dailyKey` to `todayKey`. A player who is on yesterday's daily when midnight passes sees the Daily sheet switch to today's config and 'Not started yet', but the 'Play today's daily' button calls `switchTo('daily')`, which returns immediately, then the sheet closes - a dead button with no feedback. The only way out is to switch to the free game and back. The rollover also silently discards the in-progress daily on the next launch, since loadGame's freshness check compares dailyKey with today (GameScreen.tsx:128-132).

Evidence:

```
src/screens/GameScreen.tsx:197 `const todayKey = dateKey(new Date());`
src/screens/GameScreen.tsx:222-228 the 1s `setInterval` dispatching 'tick' keeps re-rendering, so todayKey rolls over live
src/screens/GameScreen.tsx:297 `if (state.mode === mode) return;`
src/components/DailySheet.tsx:342-349 `label={p.active ? 'Back to the board' : ...} onPress={() => { p.onPlay(); p.onClose(); }}`
src/screens/GameScreen.tsx:128-132 `if (savedDaily && savedDaily.dailyKey === today && savedDaily.status === 'playing') { daily = savedDaily; } else if (savedDaily) { clearDailyGame(); }`
```

**Recommendation.** Widen the guard: `if (state.mode === mode && !(mode === 'daily' && state.dailyKey !== todayKey)) return;`, and let the daily branch below build the new day's game (it already handles `next.dailyKey !== todayKey`). Park the stale daily rather than dropping it, or tell the player the day has rolled over.

### MISS-4 · Save validation is shallow enough that a corrupt save can wedge the app on every launch

**Severity:** Low · **Category:** reliability · **Effort:** small · **Where:** `src/storage.ts:10`

`looksLikeState` checks that four fields are arrays and that `values` has 81 entries; it never checks the length or element types of `solution`, `given` or `tokens`, never validates `history` entries, and `normalize` only repairs `phantoms`, `settings` (by spreading over defaults), `mode`, `dailyKey`, `elapsed` and the phantom counters. A save whose `tokens` array is short or holds out-of-range indices passes validation and then indexes `positions.current![token]` as undefined in Board (line 118), throwing during render; a non-array `settings.enabledShifts` survives the `{...DEFAULT_SETTINGS, ...state.settings}` merge and makes `randomShiftOfKind` return undefined, so `applyShift` throws on the first move. Because loadState only catches JSON.parse failures, the bad value is re-read on every launch and there is no in-app way to clear it. On the web build AsyncStorage is localStorage, which is directly editable and shared with anything else on the origin; on native it needs a rooted device or a bad backup restore, so this is low, not a security issue - but the fix is a few lines.

Evidence:

```
src/storage.ts:10-22 `return (\n    Array.isArray(s.values) &&\n    s.values.length === CELLS &&\n    Array.isArray(s.solution) &&\n    Array.isArray(s.tokens) &&\n    Array.isArray(s.given) &&\n    typeof s.settings === 'object' &&\n    s.settings !== null\n  );`
src/storage.ts:49-58 `try { const raw = await AsyncStorage.getItem(key); ... } catch { return null; }` - the try only covers the read and parse
src/components/Board.tsx:118 `const v = positions.current![token];`
src/engine/transforms.ts:276-279 `export function randomShift(rng, enabled) { if (enabled.length === 0) return null; return randomShiftOfKind(rng, pick(rng, enabled)); }` - a non-ShiftKind falls through every case and returns undefined
```

**Recommendation.** Extend looksLikeState to check `solution.length === CELLS`, `given.length === CELLS`, `tokens.length === CELLS` and that tokens is a permutation (`new Set(tokens).size === CELLS`), and in normalize coerce `enabledShifts` to `ALL_SHIFT_KINDS.filter((k) => Array.isArray(raw) && raw.includes(k))`. Wrap the top-level render in an error boundary that offers to clear the saved game, so a bad save can never be permanent.

### SC-1 · npm audit: 10 moderate advisories, all transitive build-time toolchain (uuid <11.1.1 via xcode in @expo/config-plugins)

**Severity:** Info · **Category:** supply-chain · **Effort:** trivial · **Where:** `package-lock.json`

The pre-computed audit reports 10 moderate findings that all chain back to `uuid@7.0.3` (missing buffer bounds check in v3/v5/v6 when a buffer is supplied) pulled in by `xcode@3.0.1` under `@expo/config-plugins`. That code runs only during `expo prebuild`/EAS build on the developer or build machine; none of it ships in the app bundle, and the app never calls uuid. `npm audit fix` offers only a breaking downgrade to expo 46, which must not be applied.

Evidence:

```
package-lock.json: `node_modules/uuid` version 7.0.3 (dependency of `node_modules/xcode` 3.0.1); audit JSON: `"uuid": { "severity": "moderate", "range": "<11.1.1", "isDirect": false }`
```

**Recommendation.** No action needed for the shipped app. Let Dependabot (CI-1) track Expo SDK patch releases, which will pull a fixed `xcode`/`uuid` when upstream updates; do not run `npm audit fix --force`.

### CFG-1 · eas.json development profile requests a dev client that is not installed and no URL scheme is configured

**Severity:** Info · **Category:** ci-cd · **Effort:** trivial · **Where:** `eas.json:7`

The `development` build profile sets `developmentClient: true`, but `expo-dev-client` is not in package.json and app.json defines no `scheme`, both of which a development client build needs. `eas build --profile development` will stop with an 'expo-dev-client is not installed' error. The preview and production profiles are unaffected.

Evidence:

```
eas.json:6-9 `"development": { "developmentClient": true, "distribution": "internal" }`
package.json:5-17 dependencies list contains no `expo-dev-client`; app.json has no `scheme` key
```

**Recommendation.** Either `npx expo install expo-dev-client` and add `"scheme": "sudokuoku"` to app.json, or delete the `development` profile until it is needed.

## Upgrades

| Value | Effort | Upgrade | Now | Move to |
|---|---|---|---|---|
| high | trivial | Replace the Expo template LICENSE with the owner's own | LICENSE is the MIT text copyrighted '2015-present 650 Industries, Inc. (aka Expo)' as shipped by the create-expo-app template | MIT (or the licence of choice) with the owner's name and 2026; keep Expo's notice only if template code is deliberately retained |
| high | trivial | Set userInterfaceStyle to automatic so the System theme can actually go dark on device | app.json: 'userInterfaceStyle': 'light'; top-level legacy 'splash' key with a single light backgroundColor #f4f5f9 | 'userInterfaceStyle': 'automatic' plus the expo-splash-screen config plugin with a dark variant (dark.backgroundColor, dark.image); drop the legacy splash key |
| high | small | Finish EAS and app-store readiness | app.json has bundle ids and icons but no extra.eas.projectId/owner, no scheme, no ios.infoPlist; eas.json has cli.version >= 16, three build profiles, an empty submit.production and no appVersionSource; no privacy policy anywhere | run eas init (adds extra.eas.projectId and owner); add scheme 'sudokuoku' (the development profile's developmentClient needs one, and deep links will too); ios.infoPlist.ITSAppUsesNonExemptEncryption: false; cli.appVersionSource: 'remote' explicitly since production uses autoIncrement; fill submit.production (ios.ascAppId/appleTeamId, android.serviceAccountKeyPath and track); add PRIVACY.md and a hosted privacy policy stating nothing leaves the device (both store listings ask for a URL); document the release steps in README |
| high | small | Add ESLint (eslint-config-expo) and Prettier, wired into npm run check and CI | No ESLint or Prettier configuration; six '// eslint-disable-next-line react-hooks/exhaustive-deps' comments in src/screens/GameScreen.tsx and src/components/Board.tsx are inert; SettingsSheet.tsx lines 171-259 are unindented JSX; unused imports (Pressable in GameScreen.tsx, Pressable and shadow in SettingsSheet.tsx) pass typecheck | npx expo lint to scaffold eslint.config.js with eslint-config-expo (flat config) and eslint-plugin-react-hooks; Prettier with a .prettierrc; 'lint' and 'format:check' scripts added to 'check' and to ci.yml; if experiments.reactCompiler is enabled for this SDK, also eslint-plugin-react-compiler so compiler bail-outs are visible |
| high | medium | Stop the one-second timer tick from re-rendering the whole board | reduce() returns a new state object on every 'tick' (src/engine/game.ts:420); GameView passes the whole state to Board, which is not memoized, so all 81 Pressables, the flash views, the selection ring and 81 Animated token views re-render every second, and describeCell() runs 81 times per render | keep elapsed out of the reducer (ref-backed timer that writes into state only on the 10-second persist and on win) or wrap Board in React.memo and pass the slices it needs (tokens, values, given, notes, selected, phantoms, moves, lastShift, shiftCount, settings) so identities are stable between ticks; memoize the 81 labels per version |
| medium | small | Tighten TypeScript beyond expo/tsconfig.base strict | tsconfig.json extends expo/tsconfig.base and sets only strict: true; TypeScript ~6.0.3 | add noUncheckedIndexedAccess, noUnusedLocals, noUnusedParameters, noFallthroughCasesInSwitch and exactOptionalPropertyTypes; stay on TS 6.x and trial the native TypeScript 7 (tsgo) preview for faster typecheck once expo/tsconfig.base supports it |
| medium | trivial | Upgrade vitest 3 to 4 and measure engine coverage | vitest ^3.2.7 (lockfile 3.2.7); no coverage provider; vitest.config.ts includes only src/**/*.test.ts in a node environment | vitest ^4 with @vitest/coverage-v8, coverage.include ['src/engine/**', 'src/utils/**', 'src/storage.ts'] and a lines threshold (~90%) enforced in CI |
| medium | medium | Add component tests with jest-expo and @testing-library/react-native | All seven suites are pure-engine vitest tests; nothing renders Board, GameScreen, NumberPad, the sheets, or exercises the AsyncStorage round trip | jest-expo preset for a small RN suite: Board renders 81 cells with the expected accessibilityLabel from describeCell and marks locked cells disabled; NumberPad disables fully placed digits except in notes mode; SettingsSheet preset tap calls onChange(preset.rules); GameScreen restores a saved free and daily game from a mocked AsyncStorage; keep vitest for the engine |
| medium | small | Harden the GitHub Actions workflow | .github/workflows/ci.yml: actions/checkout@v4 and actions/setup-node@v4 by tag (0/2 pinned to SHA), no permissions block, no concurrency group, triggers on push to every branch and on pull_request (double runs for PR branches), steps: npm ci, typecheck, test, expo export android and web to /tmp (discarded) | pin both actions to commit SHAs (Dependabot keeps them fresh); permissions: contents: read; concurrency with cancel-in-progress keyed on github.ref; push only on the default branch; add npx expo-doctor, npx expo install --check, npm run lint, an advisory npm audit --audit-level=high (the 10 moderates are build-time uuid via xcode inside @expo/config-plugins and cannot be fixed from this repo), and upload the web export as an artifact |
| medium | trivial | Add Dependabot for npm and github-actions with Expo SDK packages grouped | No .github/dependabot.yml or renovate.json | .github/dependabot.yml: weekly npm updates with one group for expo, expo-*, @expo/*, react, react-dom, react-native and react-native-* limited to minor/patch (SDK-pinned packages must move via npx expo install --fix at SDK upgrade time), a second group for devDependencies, plus github-actions updates |
| medium | small | Slim what is persisted on every move | GameState.history keeps up to MAX_HISTORY = 200 snapshots, each holding six 81-element arrays plus phantoms and the solution, and saveGame JSON.stringifies the whole state into AsyncStorage after every board change (src/screens/GameScreen.tsx:238-241) | persist history as applied actions plus shift events (all reproducible from the seed) or cap persisted history at ~30 entries while keeping 200 in memory; save a lightweight projection rather than the raw state |
| medium | small | Honour the OS reduce-motion and large-text settings, and close the remaining a11y gaps | reduceMotion is only a manual switch (SettingsSheet.tsx:299), nothing reads AccessibilityInfo.isReduceMotionEnabled(); no maxFontSizeMultiplier so the nine-key NumberPad and four Controls overflow at large Dynamic Type; ShiftBanner and the phantom status line have no accessibilityLiveRegion for Android; Sheet lacks accessibilityViewIsModal; Press hard-codes android_ripple '#00000014', invisible on the dark packs | default settings.reduceMotion from isReduceMotionEnabled() and follow the reduceMotionChanged event; maxFontSizeMultiplier around 1.3 on pad and control labels and let the board shrink; accessibilityLiveRegion='polite' on the banner text; accessibilityViewIsModal on Sheet; ripple colour from the theme |
| medium | small | Guard the UI with an error boundary and stricter save validation | No ErrorBoundary; storage.looksLikeState checks values/solution/tokens/given/settings but not notes, history entries or phantom shapes, and normalize() trusts them, so a corrupt save reaches Board or undo and would crash on every launch with no recovery path | a top-level boundary in App.tsx that offers 'Start a fresh game' (clears the two game keys, keeps the profile); validate array lengths and element types in looksLikeState; a 20-line class component or react-native-error-boundary |
| medium | small | Publish the web export to GitHub Pages from CI | ci.yml runs expo export --platform web into /tmp and discards it; app.json web config is favicon and bundler: metro only | a deploy job on the default branch using actions/upload-pages-artifact and actions/deploy-pages with experiments.baseUrl set to the repo path; add web.name, themeColor and backgroundColor |
| low | trivial | Declare the Node version once | ci.yml hard-codes node-version: 22; no .nvmrc and no engines field in package.json | .nvmrc with 22 (or 24, the active LTS) and engines.node '>=22' in package.json; setup-node reads node-version-file: .nvmrc |
| low | medium | Externalise strings and localise dates | All UI and accessibility strings are inline English across the components and src/utils/describe.ts; DailySheet shows the raw YYYY-MM-DD key; date and number formatting is manual | a src/strings.ts table (or i18n-js with expo-localization) that describeCell/describeShift and the sheets read from; format todayKey with toLocaleDateString; keep dateKey local-date based |
| low | trivial | Add CHANGELOG, SECURITY.md and a release checklist | README, AGENTS.md and LICENSE only; version 1.0.0 in package.json and app.json after fourteen feature commits with no release notes | CHANGELOG.md in Keep a Changelog form (it becomes the store 'what's new' text), a short SECURITY.md (no network, report via GitHub issues), and a Releasing section covering version bump, eas build --profile production and eas submit |
| low | trivial | Platform stack is current; nothing to migrate | expo ~57.0.20, react-native 0.86.3, react 19.2.3, react-native-web 0.21.2, react-native-safe-area-context ~5.7.0, @react-native-async-storage/async-storage ^2.2.0, @expo/vector-icons ^15.1.1, expo-haptics ~57.0.2, expo-status-bar ~57.0.1: all in the SDK 57 bundled set; new architecture only (the legacy architecture was removed in RN 0.82); no deprecated expo-* modules; no expo-router needed for one screen; TypeScript 6.0.3 | no upgrade now; at SDK 58 run npx expo install --fix and expo-doctor; the only legacy configuration in use is the top-level app.json splash key covered above |
| low | small | Trim the web bundle's icon font | @expo/vector-icons Ionicons ships its full font (~440 KB) to the web export for the 25 glyphs named in src/components/ui/Icon.tsx | keep Ionicons on native but on web serve a subset font built from ICONS (or inline SVGs behind the same Icon component) |

- **Replace the Expo template LICENSE with the owner's own** (high value, trivial, `LICENSE`). As committed the file grants no licence from the actual author and misattributes the whole codebase; store reviewers and anyone forking read this file first.
- **Set userInterfaceStyle to automatic so the System theme can actually go dark on device** (high value, trivial, `app.json`). With 'light' the native app declares light-only, so useColorScheme() in src/theme.tsx always returns 'light' and the default preference 'system' (DEFAULT_SETTINGS.theme) can never select the dark palettes on iOS/Android; only the explicit Dark switch works, contradicting README and Settings. The legacy splash key is superseded by the plugin, which is also the only way to get a dark splash.
- **Finish EAS and app-store readiness** (high value, small, `eas.json`). eas build prompts or fails without a linked project and scheme, every TestFlight upload will ask the export-compliance question, and eas submit cannot run against an empty profile.
- **Add ESLint (eslint-config-expo) and Prettier, wired into npm run check and CI** (high value, small, `package.json`). The code already assumes ESLint exists; without it the hooks-deps suppressions document intent nothing enforces, and dead code accumulates unnoticed.
- **Stop the one-second timer tick from re-rendering the whole board** (high value, medium, `src/components/Board.tsx`). This is the app's dominant runtime cost on mid-range Android: ~250 views re-rendered on the most frequent state change in the game.
- **Tighten TypeScript beyond expo/tsconfig.base strict** (medium value, small, `tsconfig.json`). The engine indexes arrays everywhere (grid[p], PEERS[p], TITLES[0][1], state.phantoms[pos]!) and noUncheckedIndexedAccess makes the few real non-null assumptions explicit; noUnusedLocals would have caught the dead imports and style keys in SettingsSheet.tsx and GameScreen.tsx at compile time.
- **Upgrade vitest 3 to 4 and measure engine coverage** (medium value, trivial, `vitest.config.ts`). Vitest 4 is the current major; the engine is what the whole product rests on and its coverage is not measured today, so the untested branches listed under code_quality are invisible.
- **Add component tests with jest-expo and @testing-library/react-native** (medium value, medium, `package.json`). The two-layer board and the accessibility labelling are the riskiest UI code and have zero automated coverage; a vitest node environment cannot render react-native, so a second runner is the pragmatic route.
- **Harden the GitHub Actions workflow** (medium value, small, `.github/workflows/ci.yml`). Unpinned tags are the standard supply-chain gap, the default token is write-scoped, and expo-doctor / install --check catch SDK version drift before an EAS build does.
- **Add Dependabot for npm and github-actions with Expo SDK packages grouped** (medium value, trivial, `.github/dependabot.yml`). Solo side projects rot silently; grouping stops Dependabot proposing expo-haptics 58 against an SDK 57 app and keeps the action SHAs current once pinned.
- **Slim what is persisted on every move** (medium value, small, `src/storage.ts`). A long expert game writes hundreds of KB per move on the JS thread; on Android AsyncStorage is one SQLite row per key with a 6 MB default total that the two saved games and the profile share.
- **Honour the OS reduce-motion and large-text settings, and close the remaining a11y gaps** (medium value, small, `src/screens/GameScreen.tsx`). README sells accessibility as a feature; these are the gaps a VoiceOver/TalkBack or large-text player hits first.
- **Guard the UI with an error boundary and stricter save validation** (medium value, small, `src/storage.ts`). Everything lives in local storage with no server to repair it; a crash loop on launch means an uninstall.
- **Publish the web export to GitHub Pages from CI** (medium value, small, `.github/workflows/ci.yml`). The owner already publishes other projects to Pages; a playable link is the cheapest way to share the game and gives the daily result card somewhere real to point.
- **Declare the Node version once** (low value, trivial, `package.json`). Keeps local, CI and the EAS build image on the same runtime and makes the choice visible.
- **Externalise strings and localise dates** (low value, medium, `src/utils/describe.ts`). A second store language is impossible without it, the screen-reader strings are the most worth translating, and it is cheap now and expensive after another twenty components.
- **Add CHANGELOG, SECURITY.md and a release checklist** (low value, trivial, `CHANGELOG.md`). Low ceremony for a solo developer but exactly what each store release will need.
- **Platform stack is current; nothing to migrate** (low value, trivial, `package.json`). Recorded so effort goes to the items above rather than a platform migration.
- **Trim the web bundle's icon font** (low value, small, `src/components/ui/Icon.tsx`). Only matters once the web export is published; it is the single largest asset in that bundle.

## Features worth adding

- **Auto-notes and automatic peer-note clearing** (high value, small). src/engine/sudoku.ts already exposes candidates(grid, p) and PEERS. Add a Controls button 'Auto notes' dispatching a new 'autoNotes' action that sets notes[p] = candidates(values, p) for every empty, unlocked cell, and make the 'input' case in game.ts clear bit d from notes of every PEERS[p] when a digit is placed, behind a Settings switch 'Clear notes automatically'. Notes already travel with shifts via applyToNotes. Reducer tests: peers lose the bit, givens and locked cells untouched, undo restores.
- **Share and replay a free game by seed via deep link** (high value, small). WinSheet already prints 'seed N' and newGame(settings, seed) is deterministic. Add scheme 'sudokuoku' to app.json, build sudokuoku://play?seed=N&difficulty=hard&preset=chaos, add a 'Challenge a friend' button on WinSheet that Share.share()s it with the time to beat, and in GameScreen use Linking.useURL() to start that exact game (confirming if a free game is in progress). The web export gets the same behaviour from a ?seed= query.
- **Daily archive: play past dailies from the calendar** (high value, medium). profile.daily keeps every result and dailySeed(key)/dailyConfig(key) work for any date. In DailySheet make the seven day dots tappable and add a month grid, calling a new onPlayArchive(key) that runs newGame(dailySettings(base, dailyConfig(key)), dailySeed(key), { mode: 'daily', dailyKey: key, archive: true }). recordGameWin must skip streak, bestStreak and the daily badges when archive is true and store the result flagged so dayHeld ignores it. Test: an archive win never changes currentStreak.
- **Cross-platform confirm dialogs and a clipboard share fallback (fixes the web build)** (high value, small). react-native-web's Alert is a no-op, so on the web export 'New game' with moves > 0 (src/screens/GameScreen.tsx:364), 'Reset progress' (line 507) and the share fallback (line 551, hit whenever navigator.share is absent, i.e. every desktop browser) silently do nothing. Add a ConfirmSheet built on Sheet.tsx with two PrimaryButtons and use expo-clipboard to copy the result card with a small toast when Share.share rejects. The same component can host the daily 'one attempt, no restarts' warning.
- **Retry-proof phantom recalls (close the undo loophole)** (medium value, small). Commit 99b3957 stopped hints farming recalls, but 'undo' (src/engine/game.ts:432) restores the phantom record and phantomsRecalled/phantomsMissed from the snapshot, so a player can guess, undo and guess again until the recall counts, farming Total Recall and Medium. Keep recall outcomes outside Snapshot (as hintsUsed already is) or mark the record attempted so scoreRecall only scores the first fill. Add 'undo after a missed recall does not allow a second scored attempt' to phantom.test.ts.
- **Generate the next puzzle off the critical path** (medium value, small). startNewGame and switchTo (GameScreen.tsx:295-355) call newGame() synchronously inside the tap handler; expert generation runs countSolutions up to 81 times and stalls the UI on device with no spinner (the 'Shuffling the digits' loader only exists at launch). Pre-generate the next free puzzle for the current difficulty in InteractionManager.runAfterInteractions after each win or new game and hold it in a ref; let newGame() accept a prebuilt Puzzle. Fall back to the Loading view while generating.
- **Tiered hints instead of an answer dump** (medium value, medium). The 'hint' action (game.ts:483) writes solution[p] outright. Add a level: 1 highlights a cell with a naked single (via candidates()), 2 reveals that cell's candidates as notes, 3 fills it; charge 5/10/15 XP and count only level 3 towards CLEAN_HINT_LIMIT. Hook: the Controls Hint button becomes a long-press menu and the reducer takes { type: 'hint', level }. Tests per level in game.test.ts.
- **Grade puzzles by solving technique, not clue count** (medium value, large). generatePuzzle (sudoku.ts:197) stops at CLUE_TARGET and may stop early when no more clues can go, so 'expert' only means about 25 clues. Add a technique solver (naked/hidden singles, pointing pairs, naked pairs) that returns the hardest technique needed, and loop generation with a seed-derived retry counter until the grade matches the difficulty. Store a generatorVersion in GameState so old saves and past daily seeds still load. Tests: grade band per difficulty, determinism per seed.
- **Opt-in daily reminder notification** (medium value, medium). Add expo-notifications with a DailySheet switch 'Remind me at ...' that schedules a local daily trigger and cancels it once profile.daily[todayKey] exists; no server needed. Store the preference in the profile, handle the permission prompt and the Android channel, default off.
- **Backup and restore progress** (medium value, small). There is no sync and reset is destructive. Add 'Export progress' on ProgressSheet that shares (or saves via expo-file-system and expo-sharing) the JSON of normalizeProfile(profile) with a version and checksum, and 'Import' via expo-document-picker that runs normalizeProfile and merges badges and daily by max. Put the merge in progress.ts as a pure function with tests.
- **Pause and hide the board when the app is backgrounded** (low value, small). The timer already stops on AppState changes (GameScreen.tsx:215-228) but the board stays visible in the app switcher and a daily can be studied off the clock. Add a paused overlay (plus an explicit Pause button on the stats row) that hides the board while AppState is not active or the player pauses, reusing the Sheet backdrop styling and persisting the paused state.
- **Haptics and sound preferences** (low value, trivial). haptic() in GameScreen.tsx fires on every cell tap, shift and win with no way to switch it off. Add settings.haptics to SHARED_SETTING_KEYS and the Assistance section of SettingsSheet and gate haptic(); optionally a light click/whoosh via expo-audio behind a second switch.

## Code quality

- **Rule defaults defined three times and key lists four times** (high value, small, `src/engine/presets.ts`). The default rule values (no-relabel shift list, shiftEvery 1, shiftsPerMove 1, phantomEvery 3, phantomLockMoves 5, phantomMax 3) live in DEFAULT_SETTINGS (game.ts:62), presets base (presets.ts:36) and dailySettings (progress.ts:69), with ALL_SHIFT_KINDS.filter(k => k !== 'relabel') spelled out in each. GameScreen.tsx then hand-lists the same keys as SHARED_SETTING_KEYS (line 76) and pickFreeRules (line 533), which must stay the complement of RULE_KEYS. Export DEFAULT_RULES and DEFAULT_SHIFT_KINDS from presets.ts, build DEFAULT_SETTINGS and dailySettings from them, and derive the GameScreen lists from RULE_KEYS.
- **Split Settings into per-game Rules and global Preferences** (high value, medium, `src/engine/game.ts`). Theme, colour pack, reduce motion, highlighting, preview and phantom marker/fade preferences are stored inside every GameState and re-copied on each free/daily switch via pickShared (GameScreen.tsx:88, 307-322, 337). A Preferences object with its own storage key, loaded once and provided via context, plus a Rules object on GameState removes that juggling, the SettingsSheet daily branching, and the ThemeProvider dependency on the current game. Migration: normalize() in storage.ts lifts preferences out of an old save.
- **ProgressSheet streak ignores streak freezes** (high value, trivial, `src/components/ProgressSheet.tsx`). Line 37 calls currentStreak(profile.daily, todayKey) without profile.frozenDays, while DailySheet.tsx:44 and GameScreen.tsx:373 pass them, so after a freeze rescues a run the Progress sheet shows a shorter or zero streak than the Daily sheet. Pass frozenDays and make the parameter required so the compiler catches the next omission.
- **Missing tests for critical paths** (high value, medium, `src/engine/__tests__/game.test.ts`). Add: (1) src/storage.ts round trip against a mocked AsyncStorage covering the legacy { state, elapsed } wrapper, corrupt JSON returning null, and a save missing phantoms/notes being normalised; (2) ensurePlayable force-unlock: filling the last unlocked cell while phantoms are locked sets unlocked on all of them (phantom.test.ts only asserts a playable cell always exists); (3) undo after a missed recall; (4) nextShift with shiftsPerMove 2 predicts only the first shift; (5) applyShift keeps selected on its token for every shift kind, not just rotate; (6) utils/time.formatTime with hours; (7) rng shuffle determinism and randomSeed being uint32; (8) applyStreakFreeze is a no-op when yesterday is already frozen and MAX_FREEZES holds through refreshStreak; (9) recordGameWin keeps the minimum bestTime/fewestShifts on a slower second win; (10) the speed badge's <= 2 hints versus CLEAN_HINT_LIMIT 3 is intentional; (11) describeCell for an unlocked phantom awaiting recall.
- **countSolutions and solve duplicate the same backtracking search** (medium value, small, `src/engine/sudoku.ts`). Lines 97-133 and 136-165 are the same most-constrained-cell search with a different termination. Extract search(g, onSolution) and implement both on it. That also gives one place to swap the per-node candidates()-over-PEERS recomputation for row/column/box bitmasks, which is the cost behind slow expert generation.
- **Shift-seed formula duplicated between shiftRng and nextShift; unnamed shift cap** (medium value, trivial, `src/engine/game.ts`). shiftRng (line 227) and nextShift (line 514) both hard-code seed ^ (moves * 0x9e3779b1); extract shiftSeed(seed, moves) so the preview cannot drift from the real stream. nextShift previews only the first of shiftsPerMove shifts: return Shift[] or document it. Name the cap in Math.min(4, shiftsPerMove) (line 402) MAX_SHIFTS_PER_MOVE; SettingsSheet offers 1-3 while README says four.
- **GameScreen.tsx is a 646-line god component** (medium value, medium, `src/screens/GameScreen.tsx`). GameView owns loading, the timer, persistence, two accessibility announcers, win recording, mode switching, new-game confirmation and six sheets. Extract useGameTimer(status, dispatch), usePersistedGame(state), useShiftAnnouncements(state), useWinRecorder(state, profile), useModeSwitch(...) returning switchTo/startNewGame, and useProfile() wrapping setProfile + saveProfile. Each becomes testable and most of the five exhaustive-deps suppressions disappear.
- **Board recomputes lock state without the unlocked flag** (medium value, trivial, `src/components/Board.tsx`). Line 249, const locked = phantom !== null && moves < phantom.unlockAtMove, ignores ph.unlocked, which ensurePlayable (game.ts:287) sets to force-release locks. The bottom layer uses isLocked(), so a force-released cell is tappable while the token layer still draws the ghost and a countdown (line 288). Use isLocked(state, pos) in both places.
- **Snapshot history is heavy and partly redundant** (medium value, medium, `src/engine/game.ts`). Each of up to 200 Snapshots copies solution, given, values, notes, tokens and phantoms (six 81-element arrays) although every shift is reproducible from its Shift (dest is a bijection, so the inverse is trivial) and every move touches one cell. Store a compact entry { shifts, pos, prevValue, prevNotes, prevPhantom, counters } and rebuild on undo, or keep snapshots and drop solution/given/tokens in favour of replaying the shift list. This is the same data the persistence upgrade serialises on every move.
- **Dead code and unused imports** (low value, trivial, `src/components/SettingsSheet.tsx`). Unused imports Pressable (line 2) and shadow (line 15); six unused style keys segmented, segment, segmentActive, segmentLabel, segmentLabelActive and the empty packActive, left behind when ui/Segmented was extracted; snake_case active_preset (line 85). GameScreen.tsx imports Pressable (line 10) and never uses it. noUnusedLocals plus ESLint would flag all of it.
- **Two time formatters and two shift-icon tables** (low value, trivial, `src/engine/progress.ts`). formatClock (line 168, minutes:seconds only, so a 65-minute daily shares as '65:12') duplicates src/utils/time.ts formatTime, which handles hours; use formatTime in shareText and adjust the share test. ShiftBanner.tsx:24 defines ICONS per ShiftKind while transforms.ts:82 defines CATEGORY_ICON per category with overlapping glyphs; keep one SHIFT_KIND_ICON table in transforms.ts beside SHIFT_KIND_LABEL.
- **Four copies of the label/value stat tile** (low value, small, `src/components/WinSheet.tsx`). Stat in GameScreen.tsx:555, WinSheet.tsx:19 and DailySheet.tsx:145 and Cell in ProgressSheet.tsx:131 are the same two-Text tile with slightly different padding, three of them taking the parent's styles object as a prop. Add components/ui/StatTile.tsx with size and tone props and delete the copies.
- **Magic numbers and README/code drift** (low value, trivial, `src/engine/game.ts`). The hash salts 0x9e3779b1, 0x5bd1e995 and 0x85ebca6b (lines 227-232) and 0x5d0d0c0 (progress.ts:38) deserve a one-line comment each (golden-ratio and MurmurHash constants used only to decorrelate streams). Board.tsx font ratios 0.58/0.42/0.26/0.24 and the SHIFT_MS + 500 flash, GameScreen's height * 0.5 and Math.max(200, ...) board bounds, and the ShiftDemo seed 20260906 should be named. README restates BASE_XP, the level formula, CLEAN_HINT_LIMIT and the badge list by hand; either generate that section or point at progress.ts.
- **afterMove ordering is subtle and undocumented** (low value, trivial, `src/engine/game.ts`). afterMove (line 377) checks the win before phantoms expire, spawns a phantom before the shift (so exclude refers to the pre-shift position, and startedAt is wall-clock while everything else is move-indexed), runs ensurePlayable after spawning, then applies up to four shifts from a stream keyed on the new move count. Each ordering matters for the preview and for reproducibility; add a comment block spelling out the pipeline and note on Phantom that startedAt/fadeMs are UI-only.
- **SettingsSheet swatches and next-game difficulty ignore live state** (low value, trivial, `src/components/SettingsSheet.tsx`). Line 272 picks pack.dark only when settings.theme === 'dark', so with the System preference on a dark device the swatches preview the light palette; use useTheme().dark. Line 84 seeds the next-game difficulty into local state once, so after switching to the daily or loading a saved game the footer can read 'New medium game' for a hard setting; derive it from props or reset it when visible changes.
- **theme.tsx mixes 330 lines of palette data with the provider** (low value, trivial, `src/theme.tsx`). The six packs (lines 120-380) dwarf the ThemeProvider, useTheme and useStyles logic. Move them to src/theme/packs.ts with a small type-level check that every pack's light and dark palettes define every Colors key (the Colors type already enforces this for the spread helpers), leaving theme.tsx as the runtime.

## Shared across all Platteration repositories

The same gaps recur in every repository; fixing them once as a template and copying it is cheaper than fixing them fourteen times.

### CI and supply chain

1. **No workflow sets `permissions:`** (except the two Pages deploy jobs). Add `permissions: { contents: read }` at the top of every workflow so the `GITHUB_TOKEN` handed to third-party actions cannot write to the repository.
2. **No action is pinned to a commit SHA** (0 of 50 `uses:` lines across the fourteen repositories). `actions/checkout@v4` follows a movable tag; pin to the full 40-character SHA with the version in a comment, and let Dependabot bump it.
3. **No repository has Dependabot or Renovate.** Add `.github/dependabot.yml` with `npm` (or `pip`) and `github-actions` ecosystems, weekly.
4. **No CI step runs `npm audit`** (two workflows pass `--no-audit` explicitly). Add `npm audit --audit-level=high` after `npm ci`; for the Expo apps the current transitive advisories are build-time only (`uuid` via `xcode` via `@expo/config-plugins`), so gate on `high` rather than `moderate` until Expo ships the fix.
5. **`tvsham` runs `npm ci || npm install` in CI and in its Dockerfile.** The fallback silently discards the lockfile guarantee; drop it and fix the lockfile instead.
6. **`selfreportle`, `simplacad` and `phonogeometry` have no lockfile** and install Playwright ad hoc in CI. Add a `package-lock.json` (even with devDependencies only) and use `npm ci`.
7. **Enable secret scanning and push protection** in each repository's settings; nothing is committed today, and this keeps it that way.

### Repository hygiene

8. **Ten repositories have no `LICENSE`** (battleshiple, collectcollect, drawdraw, multidcheckers, multidconnect4, notenote, randostats, selfreportle, simplacad, tvsham). Without one, nobody else may legally use or contribute to the code. The siblings that have one use MIT.
9. **Only `simplacad` has a `SECURITY.md`.** Copy it to the others with a private reporting address.
10. **No repository has a `main` branch.** In all fourteen the default branch is the original `claude/...` feature branch, so branch protection, Dependabot targets and the two GitHub Pages workflows (`abientnoiser`, `chesscheatser` both trigger on `main`/`master`) all point at a branch that does not exist; those deploys have never run. Create `main` from the current branch, make it the default, and protect it.
11. **`drawdraw` is the one repository still on Expo SDK 53** (the rest are on 57). Its eight high-severity `npm audit` findings (`image-size`, `metro`) disappear with the SDK upgrade; it is also the only app not written in TypeScript and the only one pinned to Node 20 in CI.
12. **`multidcheckers` and `multidconnect4` are near-identical copies** (same branch name, same 65-file layout, same dependencies). The timeline/multiverse engine, persistence and share code should live in one shared package so fixes land in both.

### A hardened workflow to copy

```yaml
name: CI
on:
  push:
    branches: ["**"]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<full-sha> # v4
      - uses: actions/setup-node@<full-sha> # v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npm run lint --if-present
      - run: npm run typecheck --if-present
      - run: npm test
```
