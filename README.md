# Sudokuoku

Sudoku for iOS and Android with a twist: after every move the board **shifts**,
and you never know which shift is coming. Rows slide, columns slide, the whole
board rotates or flips, every 3×3 box slides its contents. Every shift keeps
the puzzle exactly as solvable as it was, and everything you have entered stays
where it belongs.

Built with [Expo](https://expo.dev) (React Native + TypeScript). One codebase
targets iOS, Android and, for quick previews, the web.

## Running it

```bash
npm install
npm start          # then scan the QR code with Expo Go on iOS or Android
npm run ios        # iOS simulator (macOS with Xcode)
npm run android    # Android emulator or a connected device
npm run web        # browser preview
```

Store builds use [EAS Build](https://docs.expo.dev/build/introduction/):
`npx eas build --platform ios` / `--platform android`. Bundle identifiers are
set in `app.json`.

## Accessibility

Because the board rearranges under the player, position alone is not enough to
describe it. Every cell announces its contents as well as its coordinates
("Row 3, column 5, 7, given" / "empty, noted 1, 5 and 7" / "faded and locked
for 3 more moves"), and each shift and each fading digit is announced through
`AccessibilityInfo`, so the movement is not silent. A colourblind-safe High
contrast pack and a reduce motion switch are in Settings.

## Checks

```bash
npm run typecheck  # tsc --noEmit
npm test           # vitest: generator, solver, every shift, phantoms, the game reducer
npm run check      # both
```

GitHub Actions runs the same checks plus an Android and web Metro bundle on
every push (`.github/workflows/ci.yml`). `eas.json` carries development,
preview (Android APK) and production build profiles.

## How the shifting works

The board is an ordinary uniquely-solvable Sudoku. After each move (placing,
erasing or hinting a digit; notes do not count) the game picks one of the
enabled shift kinds at random, then a random variant of it:

| Kind | What the player sees |
| --- | --- |
| Rows shift inside a band | The three rows of one band slide up or down by one, wrapping. |
| Columns shift inside a stack | The three columns of one stack slide left or right by one. |
| All rows shift by 3 or 6 | Every row moves down 3 (or 6); the bands cycle. |
| All columns shift by 3 or 6 | Every column moves right 3 (or 6); the stacks cycle. |
| Board rotates a quarter turn | The whole board turns 90°, 180° or 270°, so every ring of cells rotates together. |
| Board mirrors | Flip top-to-bottom, left-to-right, or across either diagonal. |
| Every 3×3 box slides | Every box slides its own contents the same way (down, right, diagonally…), wrapping inside the box. |
| Digits shift (off by default) | Every digit becomes `d+k`, with 9 wrapping to 1. Positions do not move. |

### Why every shift is still solvable

Each shift is a *symmetry* of Sudoku: applied to any valid solution it produces
another valid solution. The game applies the same shift to the givens, the
player's entries, the pencil notes and the hidden solution, so:

- a correct entry is still correct afterwards, and a wrong one is still wrong;
- the puzzle still has exactly one solution;
- the selection follows the cell it was on.

Moves that are *not* symmetries, such as rotating a single ring of cells or
scrambling the cells of one box on its own, would break rows and columns and
leave an unsolvable board, so the game never uses them. The tests in
`src/engine/__tests__/transforms.test.ts` check every shift against this rule,
including a 300-shift random sequence that must end still uniquely solvable.

## Phantom challenge (optional)

Switch it on in Settings for a memory workout on top of the shifting. Every N
moves one filled cell becomes a **phantom**:

- its digit fades out over a few seconds and leaves the board;
- the cell locks for X moves. No value, note or hint can go in, so you have to
  hold the digit in your head and keep reasoning with it while the board keeps
  shifting;
- once the lock lifts the cell is an ordinary empty cell. Put the digit back
  from memory. A faded given counts too: the puzzle is only solved when every
  cell, phantoms included, is filled correctly.

Settings control which cells may fade (your entries, the givens, or both), how
often a phantom appears, how long it stays locked, how many can exist at once,
how fast the digit fades, and whether locked cells show a ghost marker with the
moves left. Turn the marker off to track the phantoms purely from memory.

Two guards keep the challenge fair. A phantom never appears while it would
leave you with no empty, unlocked cell to play, and if a move ever does leave
you stuck the locks release at once. The cap on concurrent phantoms means each
move nets progress even at the most aggressive settings. Phantoms travel with
shifts, undo brings the digit back, and the digit-shift relabels a fading digit
like any other.

## Daily challenge, streaks and progression

**Daily.** One puzzle per calendar day, seeded from the date so everyone plays
the same board. Difficulty follows the weekday (Monday easy, Sunday expert)
and Wednesday and Sunday are phantom days with the phantom challenge forced
on. Shifts fire every move. You get one attempt with no restarts; the game
can be left and resumed, and it survives app restarts. Finishing it produces a
Wordle-style result card you can share:

```
Sudokuoku Daily 2026-09-09 · Medium · Phantom day
⏱ 12:34 · 60 moves · 59 shifts · 👻 4/5 · no hints
🔥 5 day streak · +210 XP
```

**Streaks.** Consecutive days with the daily completed. Today counts as soon
as it is done; missing a day resets the streak. Best streak is kept.

**XP and levels.** Each win earns a base by difficulty (50 / 100 / 175 / 275),
plus one XP per shift survived (capped at 100), 10 per phantom recalled, minus
15 per hint, and a 1.5× multiplier for the daily. Level `n` starts at
`100·(n−1)²` XP, with titles from Newcomer through Ring Walker and Phantom
Whisperer to Sudokuoku Sage.

**Badges.** Two dozen milestones across wins, shifts, phantoms, dailies and
play style, for example Unshakeable (win an expert game), Storm Rider (survive
1,000 shifts), Total Recall (five phantoms, no misses), Blindfold (phantom win
with markers off) and One Week (7 day streak). New badges are announced on
the win sheet; the Progress sheet shows them all with the per-difficulty
statistics, level bar and streak.

Because a hint fills the answer in, two rules keep the rewards honest. A
hinted phantom never counts as a recall, since the hint supplies exactly the
digit that faded. And badges that claim *skill* require an **unaided win**, at
most `CLEAN_HINT_LIMIT` (3) hints; volume badges such as the win and shift
counts accept any win. Wins, streaks and XP always count, XP simply loses 15
per hint.

## Presets, looks and assists

**Presets** set the rules in one tap and never touch appearance or assistance:
Zen (nothing moves or fades), Classic, Phantom, Blindfold (phantoms with the
markers off) and Chaos (two shifts a move, every shift kind including the
digit relabel, phantoms everywhere). A shift trigger can fire up to four
shifts back to back via `shiftsPerMove`.

**Colour packs**: Classic, Paper, Terminal, Blueprint, Sunset and a
colourblind-safe High contrast, each a light and dark palette. **Reduce
motion** turns off cell sliding, the post-shift flash and the banner pop
together.

**Shift preview** is an optional assist. Because every shift is drawn from a
seeded stream keyed on the move count, the game can say exactly what the next
move will trigger. Set it to name the family (rows, columns, board, boxes,
digits), spell the move out, or stay off.

**Streak freezes** cover a missed daily. One is granted per calendar month up
to three, and one is spent on opening only when it actually rescues a run,
never on a streak that is already broken further back.

The help sheet opens with a small board that cycles through every shift kind
so the movement can be watched rather than read about. It is driven by the
real transforms, so it shows exactly what the game does.

Undo rewinds the shift together with the move. Everything is saved locally:
the free game, the daily in progress, and the profile with statistics, XP,
badges, streak freezes and daily history.

## Code layout

```
App.tsx                     entry: safe-area provider + game screen
src/engine/rng.ts           seeded PRNG so games and shifts are reproducible
src/engine/sudoku.ts        grid helpers, solver, uniqueness check, generator
src/engine/transforms.ts    the shift kinds and how they permute the board
src/engine/game.ts          game state + reducer (moves, shifts, phantoms, undo, hints, win)
src/engine/progress.ts      daily challenge, streaks, freezes, XP, levels and badges
src/engine/presets.ts       named rule sets (Zen, Classic, Phantom, Blindfold, Chaos)
src/engine/__tests__/       vitest suites for all of the above
src/components/Board.tsx    two-layer board; cells animate to their new spots
src/components/ui/          shared button layer: Press, Icon, IconButton, Segmented
src/components/ShiftDemo.tsx  auto-playing board that demonstrates each shift kind
src/components/*            number pad, controls, shift banner, sheets
src/screens/GameScreen.tsx  wires the reducer, timer, persistence, profile, free/daily switching and sheets
src/storage.ts              AsyncStorage save/load for both games, the profile and flags
src/theme.tsx               colour packs, ThemeProvider, useStyles
```
