@AGENTS.md

# Sudokuoku

Expo (React Native + TypeScript) app: Sudoku that shifts under the player after
every move (rows, columns, the whole board or every box slide; digits can
relabel), and every shift keeps the puzzle exactly as solvable. See README.md
for the rules and layout.

- Engine lives in `src/engine` and must stay free of React/React Native imports.
- `npm test` runs the vitest suites, `npm run typecheck` runs tsc, and
  `npm run check` runs both plus the conventions test.
- A save is untrusted input (`src/utils/saved.ts`): on the web build AsyncStorage
  is localStorage, which anything on the origin can edit, and on a device a bad
  backup restore does the same job. Nothing in the app clears a save by hand, so
  a corrupt one that passes validation wedges every launch. Reject what cannot
  be repaired, repair what can, and never hand back a state the reducer or the
  board can trip over.
- Exact versioned Expo docs: https://docs.expo.dev/versions/v57.0.0/

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. `npm run check` is the gate before a push. To change a
convention, change it in every repository in one pass and update the hashes in the test.
