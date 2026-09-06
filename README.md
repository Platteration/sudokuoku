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

## Checks

```bash
npm run typecheck  # tsc --noEmit
npm test           # vitest: generator, solver, every shift, the game reducer
npm run check      # both
```

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

Undo rewinds the shift together with the move. Settings let you pick which
shift kinds are allowed, shift only every 2, 3 or 5 moves, and toggle
conflict / mistake highlighting and animation. The game and its settings are
saved locally so you can pick up where you left off.

## Code layout

```
App.tsx                     entry: safe-area provider + game screen
src/engine/rng.ts           seeded PRNG so games and shifts are reproducible
src/engine/sudoku.ts        grid helpers, solver, uniqueness check, generator
src/engine/transforms.ts    the shift kinds and how they permute the board
src/engine/game.ts          game state + reducer (moves, shifts, undo, hints, win)
src/engine/__tests__/       vitest suites for all of the above
src/components/Board.tsx    two-layer board; cells animate to their new spots
src/components/*            number pad, controls, shift banner, sheets
src/screens/GameScreen.tsx  wires the reducer, timer, persistence and sheets
src/storage.ts              AsyncStorage save/load
```
