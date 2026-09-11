# sudokuoku — security audit (2026-09-11)

A dedicated security pass, separate from and later than the review in `REVIEW.md`. Specialist reviewers read the repository through a combined lens (L13), each required to *demonstrate* a finding rather than argue for it.

**4 findings** — 3 low, 1 info. Every one was reproduced with command output rather than argued from reading.

## Status

Every finding below was fixed on `claude/repo-review-security-baiyud` in 730bed9, each with a regression test. The findings are kept as written so the reasoning behind each change stays with it.

### Corrections to that round

A later adversarial review of those fixes found three of them overstated, and this pass corrects them. Two claims made in 730bed9's commit message were wrong and are withdrawn here, since the message itself cannot be rewritten: that the streak walk "terminates structurally rather than by a bound", and that every new test was checked by reverting the fix.

- **L13-1 was not closed.** `shiftDateKey` stepped by setting local `getDate() - 1`, and four zones have skipped a whole calendar day at the date line: Pacific/Apia and Pacific/Fakaofo never had a 2011-12-30, Pacific/Enderbury and Pacific/Kiritimati never had a 1994-12-31. Local midnight of a day that was never struck does not exist, so V8 answers with the day after it and the step was the *identity* on a key `isDateKey` accepts. Both new guards passed and the loop never left — the same CWE-835 freeze, now reachable with a valid date key and with no tampering at all: a device in one of those zones, its clock on that date, solving that day's real daily. The step is now UTC arithmetic, where every day is 86,400,000 ms wide in every zone, the walk is bounded by `MAX_STREAK_DAYS` as this audit originally recommended, and the loop breaks on a step that does not move. Termination is not structural; it is three independent things, none of them trusted alone.
- **The regression test for that loop could not fail.** vitest's `testTimeout` cannot interrupt a synchronous loop, so reverting the fix hung the suite with no output rather than reporting a failure — infrastructure flakiness, not a red test — and either of the two guards could be deleted on its own with all 144 tests still green. Now that the walk is finite by construction the tests assert returned values: reverting the step, the bound, or either guard fails in milliseconds, each caught by a different test. The property that a step never stands still is held by a test over every key `isDateKey` accepts, run in each of the four zones with `process.env.TZ` set, rather than by an argument.
- **The slot/key pairing was untested**, and transposing the two literals typechecked and passed every test while reopening L13-2 in full. The key is now derived from the slot (`GAME_KEYS` in `src/storage.ts`), so there is one literal per slot and nothing to transpose, and `src/__tests__/storage.test.ts` drives both records through a stubbed AsyncStorage.

Three smaller corrections in the same pass. A stored daily result now takes its difficulty and phantom rule *from its day* rather than merely correcting invalid ones — which is what the doc comment already claimed, and its test now feeds a valid wrong value (`expert` on an easy Monday) instead of an uncoercible one. `normalizeProfile` keeps badge ids this build does not know rather than pruning them: there is no version gate, this function writes the profile back, and the profile is the only record of a badge there is, so a downgrade or a rename was silently deleting them; the "x of 24" tally is taken over the badges this build has (`unlockedBadges`), which is what the pruning was for. And the XP clamp and the badge-array guard now have cases only they can pass.

These were deliberately left for a decision rather than guessed at:

- L13-4 — the daily is keyed to the device clock and there is no backend. The recommended monotone last-credited key does not stop the demonstrated attack (stepping the clock forward is an increasing sequence) and would silently refuse a legitimate daily after any backward clock correction or westward date-line crossing.
- **L13-2, the XP and badge half — accepted, not fixed.** The rules rebuild that closes the forged dailies, the streak and the daily badges applies to the daily slot only, because a daily's rules are a function of its date and can be rebuilt from it. A free game has no such record to rebuild from: its difficulty and shift set are whatever the player chose. Measured against the fixed code, an easy board written into the free slot claiming `difficulty: 'expert'` with every shift kind enabled still wins 275 XP for one move and mints first-win, win-expert, speed, no-hints, all-shifts and relabel — while `dailiesCompleted`, the streak and the daily badges stay at zero. Deriving the difficulty from the board does not close it: `generatePuzzle` stops *at or above* its clue target, so the bands overlap and a check strict enough to catch a forged expert would refuse legitimate games, and the generator ships in the app anyway, so a forger can produce a genuine expert board to save. Same audience and same stakes as L13-4 — the player forging their own records, no server, no accounts, no leaderboard — and not closable without a backend this repo deliberately does not have. Recorded here so L13-2 is not read as fully fixed.

## Findings

### L13-1 · low — A saved game's dailyKey is accepted as any string, and one that does not parse as a date makes currentStreak loop forever on the JS thread

`src/utils/saved.ts`:271 · CWE-835 · reproduced

**Who.** Anyone who can write one AsyncStorage record: the owner of an unlocked device with adb/root or a debug build, a restored Android backup or device-to-device transfer (app.json sets no android.allowBackup and no dataExtractionRules, so @expo/config-plugins stamps allowBackup="true" and the AsyncStorage database is in the backup set), or, on the web build where AsyncStorage is localStorage, anything else running on the same origin. They control the whole JSON blob under sudokuoku:game:v1.

**How.** 1. Write a 2 kB save under the FREE game key sudokuoku:game:v1 with a valid board one cell short of complete, status 'playing', settings.enabledShifts [] and the two fields readSavedGame does not check against each other: mode 'daily' and dailyKey 'NaN-NaN-NaN'. 2. Open the app. GameScreen restores the free slot on status alone (GameScreen.tsx:110), so the state is loaded with mode 'daily'. 3. Fill the last cell. afterMove sets status 'won'. 4. The win effect (GameScreen.tsx:284-294) calls recordGameWin, which writes next.daily['NaN-NaN-NaN'] and then calls currentStreak(next.daily, state.dailyKey, next.frozenDays) at progress.ts:547. 5. currentStreak's walk-back loop (progress.ts:166) steps with shiftDateKey, and shiftDateKey('NaN-NaN-NaN', -1) === 'NaN-NaN-NaN' — parseDateKey yields an Invalid Date and dateKey renders it back as the same string — so the key never leaves the held set and the loop never ends.

**Why it matters.** The JS thread spins forever inside a React commit: the UI freezes with no error, no frame is ever drawn again, and the app has to be force-quit. Nothing is written, so the hostile save is still on disk and the freeze repeats on every relaunch the moment the player completes the board. Availability only — no data is disclosed and no privilege is gained.

**Evidence.**

src/utils/saved.ts:271 — `dailyKey: typeof s.dailyKey === 'string' ? s.dailyKey : null,` (the only check).
src/engine/progress.ts:20-29 —
  export function parseDateKey(key: string): Date { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
  export function shiftDateKey(key, days) { const d = parseDateKey(key); d.setDate(d.getDate() + days); return dateKey(d); }
src/engine/progress.ts:164-170 —
  let key = dayHeld(daily, frozen, todayKey) ? todayKey : shiftDateKey(todayKey, -1);
  let n = 0;
  while (dayHeld(daily, frozen, key)) { n++; key = shiftDateKey(key, -1); }
src/engine/progress.ts:547 — `const streak = currentStreak(next.daily, state.dailyKey ?? dateKey(now), next.frozenDays);`  <- state.dailyKey comes straight off disk.

Run output (t1.mjs, the fixed point):
  loaded
  parsed: Invalid Date
  dateKey: NaN-NaN-NaN
  shift: NaN-NaN-NaN

Run output (poc-hang.mjs, end to end, watchdog at 25 s):
  save size: 1979 bytes
  readSavedGame accepted it? true
    restored mode     = daily
    restored dailyKey = "NaN-NaN-NaN"
  after one move, status = won
  calling recordGameWin(...) — this is what the win effect in GameScreen does
  EXIT=124 (never returned)

For contrast, the same profile with a real todayKey returns immediately: `currentStreak(profile.daily, '2026-09-11', {})` -> `result = 0`. The DAILY slot is not vulnerable, because GameScreen.tsx:121 runs isDailyStale on it and discards a key that is not today's; only the free slot skips that test.

**Fix.** Two changes, both small. (1) In src/utils/saved.ts, validate the key rather than its type: `const DAY = /^\d{4}-\d{2}-\d{2}$/;` and `dailyKey: typeof s.dailyKey === 'string' && DAY.test(s.dailyKey) && !Number.isNaN(parseDateKey(s.dailyKey).getTime()) ? s.dailyKey : null`, and make mode and dailyKey agree — `mode: s.mode === 'daily' && dailyKey !== null ? 'daily' : 'free'` — so a daily game can never carry an unusable key. (2) Make currentStreak terminate regardless of its input: reject an unparseable todayKey up front (`if (Number.isNaN(parseDateKey(todayKey).getTime())) return 0;`) and bound the walk (`while (dayHeld(...) && n < 3660)`), so no future caller can reintroduce the spin. Add a test that currentStreak(daily, 'NaN-NaN-NaN', {}) returns instead of hanging, and one that readSavedGame drops a non-date dailyKey.


### L13-2 · low — The free-game slot is restored with no mode or staleness check, so a crafted save mints daily completions, a streak and badges for arbitrary past dates

`src/screens/GameScreen.tsx`:110 · CWE-807 · reproduced

**Who.** The same person as L13-1 — whoever can write sudokuoku:game:v1 (unlocked device with adb/root, a restored Android backup, or same-origin script on the web build). Most realistically the player cheating their own records; there is no server and no shared leaderboard, so nobody else's data is at risk.

**How.** 1. For each date to be forged, write a save under sudokuoku:game:v1 with a valid board one cell short of complete, status 'playing', mode 'daily', dailyKey set to that date, and settings claiming whatever the badge checks read — difficulty 'expert', phantomMode true, hintsUsed 0 (or negative, which the validator also accepts). 2. Open the app and fill the last cell. GameScreen restores the free slot on `savedFree.status === 'playing'` alone; the isDailyStale/dailyKey test at GameScreen.tsx:121 is applied only to the daily slot, so a daily-mode state for any date is loaded and played. 3. recordGameWin credits profile.daily[dailyKey], bumps totals.dailiesCompleted, recomputes the streak ending on that date and awards every badge whose predicate now passes. 4. Repeat for consecutive earlier dates.

**Why it matters.** Forged daily results, a forged current and best streak, unearned badges and inflated XP, all written to the persisted profile and then displayed by the Daily sheet, the Progress sheet and the shared result card as if earned. The README's 'one attempt, no restarts' and 'everyone gets the same board today' rules do not hold for a restored save: the stale-daily guard the code does implement for one storage slot is simply absent for the other. Impact is confined to the player's own records.

**Evidence.**

src/screens/GameScreen.tsx:110-117 —
  if (savedFree && savedFree.status === 'playing') {
    free = savedFree;                       // no mode test, no dailyKey test
  } else { ... }
versus the daily slot at GameScreen.tsx:121 —
  if (savedDaily && !isDailyStale(savedDaily, today) && savedDaily.status === 'playing') {
src/utils/saved.ts:270-276 — mode, dailyKey, hintsUsed and every counter are restored with a type check only:
  mode: s.mode === 'daily' ? 'daily' : 'free',
  dailyKey: typeof s.dailyKey === 'string' ? s.dailyKey : null,
  hintsUsed: num(s.hintsUsed, 0),        // num() accepts negatives: hintsUsed -100 makes isCleanWin true and adds 1500 XP
src/engine/progress.ts:527 — `if (state.mode === 'daily' && state.dailyKey && !next.daily[state.dailyKey])` is the only gate on crediting a daily.

Run output (poc-daily.mjs — seven hostile saves, each won in one move):
  start: dailiesCompleted=0 xp=0 badges=0
    2026-09-05: isDailyStale=true isTodaysDaily=false -> +413 XP, streak 1, badges: first-win, win-expert, speed, no-hints, daily-first, daily-phantom
    2026-09-06: isDailyStale=true isTodaysDaily=false -> +413 XP, streak 2
    2026-09-07: isDailyStale=true isTodaysDaily=false -> +413 XP, streak 3, badges: streak-3
    2026-09-08: isDailyStale=true isTodaysDaily=false -> +413 XP, streak 4
    2026-09-09: isDailyStale=true isTodaysDaily=false -> +413 XP, streak 5
    2026-09-10: isDailyStale=true isTodaysDaily=false -> +413 XP, streak 6
    2026-09-11: isDailyStale=false isTodaysDaily=true -> +413 XP, streak 7, badges: streak-7
  end:   dailiesCompleted=7 xp=2891 bestStreak=7
  badges earned: first-win, win-expert, speed, no-hints, daily-first, daily-phantom, streak-3, streak-7
  streak shown in the UI: 7
  Sudokuoku Daily 2026-09-11 · Medium
  ⏱ 0:00 · 1 moves · 0 shifts · 👻 0/0 · no hints
  🔥 7 day streak · +413 XP
Note every save reports isDailyStale true — the app computes the answer and never consults it for this slot. 'daily-phantom' (Sunday Séance) was awarded for 2026-09-05, a Saturday, which is not a phantom day, because the badge reads settings.phantomMode off the save instead of dailyConfig(key).

**Fix.** Apply the daily rules to whatever game is restored, not to one storage key. In GameScreen's loader, treat a restored free slot whose mode is 'daily' as unusable — `if (savedFree && savedFree.status === 'playing' && savedFree.mode === 'free') free = savedFree;` — and run `isDailyStale(game, today)` on the on-screen game as well as the parked one. Better still, make readSavedGame take the slot it is reading (`readSavedGame(parsed, 'free' | 'daily')`) and force `mode` to match, so the two can never disagree. Separately, clamp the counters the reward path reads: hintsUsed, moves, shiftCount, elapsed, phantomsRecalled and phantomsMissed should be coerced to non-negative integers in readSnapshot, and recordGameWin should take the daily's difficulty and phantom flag from `dailyConfig(state.dailyKey)` rather than from the save's own settings.


### L13-3 · low — normalizeProfile never looks inside `daily`, so a stored result throws a TypeError in dailyConfig when Share result is tapped and the share card interpolates raw values

`src/engine/progress.ts`:413 · CWE-20 · reproduced

**Who.** Whoever can write sudokuoku:profile:v1 — same channels as L13-1 (adb/root on an unlocked device, a restored Android backup, or a same-origin script on the web build). Also reachable from a genuinely damaged record, since nothing in the app ever repairs or clears the profile.

**How.** 1. Write a profile whose daily map holds today's date as its key but a DailyResult whose `key` field is not a parseable date, e.g. {"2026-09-11": {"key": "not-a-date", ...}}. normalizeProfile passes the map through untouched — it checks only `typeof p.daily === 'object'`. 2. Open the Daily sheet. `const result = p.profile.daily[p.todayKey]` is truthy, so the footer renders the Share result button. 3. Tap it. DailySheet.tsx:57 calls shareText(result, streak), which calls dailyConfig(result.key) at progress.ts:232; parseDateKey returns an Invalid Date, getDay() is NaN, WEEKDAY_DIFFICULTY[NaN] is undefined, and progress.ts:64 dereferences difficulty[0].

**Why it matters.** An unhandled TypeError out of the press handler — a red box in development, a crash or a dead button in a release build, on the only path the daily sheet offers once a result exists. With a parseable key the same missing validation lets any value through into the text handed to the OS share sheet: `${result.moves} moves` interpolates a string with newlines verbatim, so the card can carry arbitrary attacker text under the 'Sudokuoku Daily' heading. The profile also accepts an array for `badges` and non-numbers inside `totals`, which then flow into arithmetic and into the Progress sheet's counts.

**Evidence.**

src/engine/progress.ts:407-418 (normalizeProfile) —
  badges: p.badges && typeof p.badges === 'object' ? p.badges : {},
  totals: { ...empty.totals, ...(p.totals ?? {}) },
  daily: p.daily && typeof p.daily === 'object' ? p.daily : {},
No per-entry validation anywhere; DailyResult fields are never touched.
src/engine/progress.ts:60-66 (dailyConfig) —
  const day = parseDateKey(key).getDay();
  const difficulty = WEEKDAY_DIFFICULTY[day];
  const cap = difficulty[0].toUpperCase() + difficulty.slice(1);   // throws when day is NaN
src/engine/progress.ts:231-240 (shareText) — `const cfg = dailyConfig(result.key);` then `${result.moves} moves` with no coercion.
src/components/DailySheet.tsx:43,57 — `const result = p.profile.daily[p.todayKey]` ... `onPress={() => p.onShare(shareText(result, streak))}`.

Run output (poc-profile.mjs):
  normalizeProfile survived. Resulting fields:
    xp        = 0   (string rejected -> 0)
    badges    = ["not","an","object"]   (an ARRAY was accepted as badges)
    totals    = {"played":null,"won":"99","cleanWins":0,...}
    daily     = {"2026-09-11":{"key":"not-a-date","elapsed":{},"moves":"x\n\n>>> free coins at http://evil.example",...}}
  dailyConfig on the stored result key:
    THREW: TypeError: Cannot read properties of undefined (reading '0')
  shareText(profile.daily[today], 1) — what "Share result" builds:
    THREW: TypeError: Cannot read properties of undefined (reading '0')
  and with a parseable key, the numeric fields are interpolated raw:
  Sudokuoku Daily 2026-09-11 · Medium
  ⏱ NaN:NaN · x

  >>> free coins at http://evil.example moves · 1 shifts · no hints
  🔥 1 day streak · +1 XP

**Fix.** Give the profile the same treatment src/utils/saved.ts already gives a game. Add a `dailyResult(raw, key)` coercer that requires the entry's own `key` to equal the map key and to match /^\d{4}-\d{2}-\d{2}$/, clamps difficulty to the four known values, coerces phantom to a boolean and elapsed/moves/shifts/hints/phantomsRecalled/phantomsMissed/xp to non-negative integers, and drops the entry otherwise; build `daily` by filtering the map through it, dropping keys that are not date strings. Require `badges` to be a non-array object with string values, and coerce every field of `totals`, `stats` and `bestStreak`/`freezes` to finite non-negative numbers. Independently, make dailyConfig total — `const difficulty = WEEKDAY_DIFFICULTY[day] ?? 'medium';` — so no caller can be crashed by a key, and format every number in shareText through a helper rather than interpolating it.


### L13-4 · info — The daily challenge is keyed entirely to the device's local clock, so rolling the date back mints a real streak and streak badges with no tooling at all

`src/screens/GameScreen.tsx`:194 · CWE-350 · reproduced

**Who.** Anyone holding the unlocked device. No root, no adb, no storage editing — only the system Settings app.

**How.** 1. Set the device date to some past day. 2. Open the app: todayKey = dateKey(new Date()) drives dailyConfig, dailySeed and the dailyKey the new game is stamped with, so that day's real daily is built and is fully playable. 3. Solve it; recordGameWin credits profile.daily for that date. 4. Step the clock forward one day and repeat. Every date is credited once (recordGameWin refuses a day already in the map), so ten clock changes produce ten genuine-looking daily results on ten consecutive dates.

**Why it matters.** A real, self-consistent ten-day streak, bestStreak 10, and the streak badges (Warming Up, One Week) plus every volume badge the ten solves pass, all recorded as legitimately earned and displayed in the Daily sheet, the Progress sheet and the share card. There is no cross-user impact: no server, no accounts, no leaderboard. This is inherent to an offline app that has nothing but the device clock to ask, and cannot be fully closed without a backend — which the repo deliberately does not have. Listed because it is the cheapest route to the forged records L13-2 reaches the hard way, and because a partial defence is available.

**Evidence.**

src/screens/GameScreen.tsx:194 — `const todayKey = dateKey(new Date());` is the sole source of truth; GameScreen.tsx:319 — `newGame(settings, dailySeed(todayKey), { mode: 'daily', dailyKey: todayKey })`. Nothing anywhere records the wall-clock moment a daily was credited or compares a new key against the furthest date already seen.

Run output (poc-clock.mjs — legitimate play only, the reducer solving each board move by move through the real shift stream; the only thing that changes is what the app is told 'today' is):
    device clock = 2026-09-02 (Medium · Phantom day) -> solved in 36 moves, +294 XP, streak 1, badges: first-win, speed, no-hints, phantom-first, phantom-perfect, daily-first, daily-phantom
    device clock = 2026-09-03 (Hard) -> solved in 52 moves, +339 XP, streak 2, badges: win-hard
    device clock = 2026-09-04 (Medium) -> solved in 47 moves, +219 XP, streak 3, badges: shifts-100, streak-3
    ... one line per day ...
    device clock = 2026-09-11 (Medium) -> solved in 47 moves, +219 XP, streak 10, badges: wins-10, hintless-10
  after ten clock changes: dailiesCompleted=10 bestStreak=10 xp=2804
  streak the UI shows today: 10
  freezes banked (one grant per calendar month key): 1
The freeze grant is the one part that already resists this: grantMonthlyFreeze caps at MAX_FREEZES, and flipping the clock between two months twelve times yields 3, not 12 (poc-freeze.mjs).

**Fix.** Accept that the clock cannot be trusted, and make the streak monotone instead. Store `lastDailyCreditedKey` on the profile and refuse to credit a daily whose key sorts before it (date keys compare correctly as strings), so completing a day earlier than one already recorded adds a result but never extends or repairs the streak. Refuse a key later than the current key outright. Say in the Daily sheet's copy that the streak is kept on the device, so the number is not presented as something it is not.


## Checked and sound

What the reviewers tried and could not break. Recorded so it is not re-raised, and so a future change that undoes one of these is recognisable as a regression.

- The attack surface really is small and I want to say so plainly: there is no network code of any kind (grep for fetch/XMLHttpRequest/WebSocket/WebView/Linking over src, App.tsx and index.ts returns nothing but a comment), no URL scheme or intent filter in app.json, no exported component beyond the launcher activity, no expo-updates, no service worker, and no eval/Function/require/dynamic import. Every byte the process reads from outside itself arrives through exactly four AsyncStorage keys it wrote earlier plus screen taps, and the only byte that leaves is plain text handed to the OS share sheet.
- No XSS or HTML-injection sink exists even on the web build: every string reaches the screen through React Native <Text>, there is no dangerouslySetInnerHTML, no innerHTML and no raw DOM construction anywhere in src/. The two web-only paths, window.confirm and window.alert (GameScreen.tsx:577, 593), take text arguments only.
- No prototype pollution. dailyKey is the only attacker-chosen string that reaches an object write, and it goes through a computed property in an object literal (`{ ...next.daily, [state.dailyKey]: result }`), which is CreateDataProperty and not the __proto__ setter. I ran dailyKey values of '__proto__', 'constructor' and 'toString' end to end through readSavedGame -> reduce -> recordGameWin: Object.prototype was untouched and the daily was not credited at all, because the inherited property read back truthy and the `!next.daily[key]` gate failed closed. Every other keyed write (badges[badge.id], stats[difficulty], frozenDays[yesterday]) uses a value from a closed set.
- cleanSettings holds against the whole Object.prototype name set: difficulty of 'constructor', '__proto__', 'toString', 'valueOf', '', 0, {} and ['expert'] all fall back to 'medium', and enabledShifts is rebuilt as ALL_SHIFT_KINDS.filter(k => raw.includes(k)) so '__proto__' in the list is dropped and a non-array falls back to the default. themePack is the one free-form string, and themePack(id) resolves it with THEME_PACKS.find(...) ?? THEME_PACKS[0] rather than a bare table index.
- A crafted save cannot make the generator or solver run unbounded. generatePuzzle is reached only through newGame, and its only input is settings.difficulty, which cleanSettings pins to one of four values, so CLUE_TARGET[difficulty] and BASE_XP[difficulty] are always defined and the removal loop is bounded by CELLS. Worst case over 200 expert seeds was 47 ms under node; countSolutions is called with limit 2 only, and solve() has no caller in the shipped app at all. The board arrays the solver reads are already bounded by isDigitGrid (81 integers, 0..9).
- JSON.parse is the only entry point for a save, which quietly closes a class of gaps I expected to matter: NaN and Infinity cannot survive JSON, so the places that test `typeof v === 'number'` rather than Number.isFinite (the phantom validator at saved.ts:183) are not actually reachable with a non-finite value — I confirmed a phantom carrying NaN/Infinity is serialised to null and then rejected. What remains reachable there is only finite nonsense: a phantom value of 42 renders as the digit 42 behind the fade, and an unlockAtMove of 1e300 locks a cell forever, but ensurePlayable (game.ts:290) releases every lock as soon as no empty unlocked cell is left, so the board still finishes.
- The board-shaped part of the save validator is genuinely tight and I could not get past it: isDigitGrid pins values and solution to 81 integers in 0..9, isFlagGrid pins given to 81 booleans, and isTokenPermutation rejects duplicates and out-of-range ids — which matters because Board.tsx:247 indexes positions.current![token] directly. Non-permutation tokens, short arrays, float ids and negative ids are all refused. notes accepts an unbounded non-negative integer, but every consumer (applyToNotes, listNotes, Board's note & (1 << d)) only reads bits 1..9, so 2**53-1 renders identically to 0x3fe.
- readSavedGame puts no cap on history length, but there is no amplification: validation is linear in the number of snapshots, JSON.parse of the file already dominates, and the first persist after load runs forStorage, which trims the array to PERSISTED_HISTORY (20) and writes the small version back — so an oversized save self-heals rather than compounding.
- The daily-slot loader is correct and was not the way in: GameScreen.tsx:121 runs isDailyStale and the status test before restoring it, and clearDailyGame() otherwise, so yesterday's daily and a finished one are both discarded. Every problem I found in this area comes from the free slot, which has neither test.
- The hint-cannot-farm-rewards invariants the previous pass added still hold under tampering from the reducer side: hintsUsed is excluded from the undo snapshot, scoreRecall(..., fromHint=true) scores a miss, and skill badges gate on clean (<= CLEAN_HINT_LIMIT). They can only be defeated by writing hintsUsed directly into the save, which is L13-2.
- Replaying a completed daily does not re-credit it: recordGameWin's `!next.daily[state.dailyKey]` gate holds, and the Daily sheet swaps Play for Share once a result exists. Repeatedly winning the same regenerated daily does inflate totals.won and XP, but at 1.5x of a board you have to actually re-solve, and solving it by hint alone floors the award at 10 XP — not a farm worth reporting.
- grantMonthlyFreeze cannot be farmed by flipping the clock between two months: twelve alternations yield 3 freezes, the MAX_FREEZES cap. applyStreakFreeze is likewise conservative — it refuses to spend on a run that is already broken further back (progress.ts:206-217).
- What a device backup exposes is nothing sensitive. app.json sets no android.allowBackup, and @expo/config-plugins/build/android/AllowBackup.js resolves `config.android?.allowBackup ?? true`, so the shipped manifest carries allowBackup="true" with no dataExtractionRules and the AsyncStorage database is in the Auto Backup / device-to-device set. Its entire contents are puzzle state, statistics, XP, badge unlock timestamps and which dates the daily was played — no credentials, no tokens, no identifiers, no free text the user typed. The meaningful half of allowBackup here is the inbound direction: a restore is an untrusted-JSON channel into loadState and loadProfile, which is why L13-1 and L13-3 matter more than they otherwise would. Setting android.allowBackup false, or adding dataExtractionRules, would close that channel cheaply, but the outbound exposure on its own does not warrant it.
- Android permissions are minimal and none are the app's own doing: expo-haptics contributes VIBRATE, and expo-file-system (a direct dependency of the expo package itself, not something this repo chose) contributes INTERNET plus READ/WRITE_EXTERNAL_STORAGE capped with android:maxSdkVersion="32", which SDK 57's targetSdk makes inert. Its FileSystemFileProvider is declared android:exported="false". Nothing in src/ uses any of them.
- The share card cannot be 'forged' in any sense that means anything: it is plain text built locally and handed to Share.share, nothing signs it and nothing claims it is signed, and a recipient's app parses nothing. The real defect in that path is the missing coercion in L13-3, not a broken signature.
- No secrets in the repo or the build: no .env, no keystore, no API key, no EAS project id, and .gitignore covers *.jks/*.p8/*.p12/*.key/*.pem/*.mobileprovision and every .env variant. The CI workflow pins both actions to full commit SHAs, declares permissions: contents: read, uses no secrets and has no pull_request_target, so a fork PR runs repo code with a read-only token and nothing to steal.
- Two things the previous review fixed, re-checked against the code rather than taken on trust: the daily's rules really are protected mid-game (reduce's updateSettings strips RULE_KEYS when state.mode === 'daily', game.ts:459, and the Presets block is inside the `daily ? null :` branch in SettingsSheet), and the persisted history really is bounded (forStorage trims to 20, saved.test.ts holds it to a byte budget). Neither fix is incomplete in the way it was described — the gap L13-2 exploits is that the mode those fixes key on is itself restored from the save without a check.
- Ran the repo's own suite as a baseline: 130 tests across 9 files, all passing. None of them exercise mode or dailyKey on a restored save, and none feed normalizeProfile anything hostile, so nothing I report is contradicted by a test that currently passes.

