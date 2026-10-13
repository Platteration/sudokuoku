@AGENTS.md

# Sudokuoku

Expo (React Native + TypeScript) app: Sudoku that shifts under the player after
every move (rows, columns, the whole board or every box slide; digits can
relabel), and every shift keeps the puzzle exactly as solvable. See README.md
for the rules and layout.

- Engine lives in `src/engine` and must stay free of React/React Native imports.
- `npm test` runs `node --test server/kit/selftest.mjs server/api.test.mjs` (the kit's own
  self-test and this app's API) and then the vitest suites, `npm run typecheck` runs tsc,
  `npm run lint` runs ESLint, and `npm run check` runs all three plus the conventions test.
  `npm run test:e2e` builds the website and plays it in Chromium under its own
  headers (see "Website" in AGENTS.md); `npm run test:all` runs both suites.
- A save is untrusted input (`src/utils/saved.ts`): on the web build AsyncStorage
  is localStorage, which anything on the origin can edit, and on a device a bad
  backup restore does the same job. Nothing in the app clears a save by hand, so
  a corrupt one that passes validation wedges every launch. Reject what cannot
  be repaired, repair what can, and never hand back a state the reducer or the
  board can trip over.
- Exact versioned Expo docs: https://docs.expo.dev/versions/v57.0.0/

## Sign-in and Support this app (the website only)

The website can sign a visitor in with Google and sell one "Support this app" payment through
Stripe Checkout, granted only by Stripe's signed webhook; it is off until the owner sets the
keys (README, "Sign-in and Support this app", lists them), and on GitHub Pages, where no function
runs, `api/config` is a 404 and nothing is drawn. A supporter gets one line of thanks in About
(`SUPPORTER_THANKS`) and nothing else: no rule, preset, pack or assist changes.

- `server/kit/` is the shared kit, a byte-for-byte copy of the canonical one: never edit it here.
  Its own self-test runs in `npm test`; it lints and type-checks under this repository's ESLint
  and `tsconfig.json` as they are (`allowJs` picks up its `// @ts-check` files), nothing ignored.
  `server/catalogue.js` is this app's catalogue (app `sudokuoku`, product `supporter`, one-time,
  granting `supporter`, priced by `STRIPE_PRICE_SUPPORTER`); `functions/api/[[path]].js` is the
  Cloudflare Pages entry and `server/start.mjs` the Node one (127.0.0.1:8788, behind
  `deploy/nginx.conf`'s `location ^~ /api/`); `server/package.json` only says these are ES
  modules. `server/fakes.mjs` is a fake Google and Stripe for the tests, handed to the kit as
  its `fetch`: nothing points the kit at another host.
- The page's side: `src/accountModel.ts` (pure: reads `api/config` and `api/me` field by field,
  the words, `loadAccount`, `accountView`, `accountActions` (Sign out, Delete account and Buy, and
  when each asks `api/me` again: a Buy answered 401 or 409 has nothing of its own to say, so the
  redrawn card is its answer) and `oneAtATime` (the sheet runs one of them at a time, refusing a
  second press before React has drawn again), which every decision goes through so vitest can
  drive it without a renderer), `src/accountClient.web.ts` (the only module that makes a request,
  to the site's own `api/` alone, and leaves only for `api/auth/google/start` or a
  `https://checkout.stripe.com/` address), its inert native twin `src/accountClient.ts`,
  `src/account.tsx` (the provider, in `App.tsx`), the Account and Support cards in
  `SettingsSheet` and `src/components/AccountNotice.tsx` on the game screen. A sign-in returns to
  the page's path and query, never its fragment, which is where a challenge link keeps its code.
- `npm run test:e2e` plays the whole flow in Chromium under the site's policy with the kit beside
  the built site (`e2e/serve.mjs`'s `api`): sign in, Buy, the signed webhook, the thanks, sign
  out, delete, a Buy after another tab signed out (401: Sign in to buy) and one of what another
  tab bought (409: Owned; pressed twice at once and asked once, Sign out and Delete account
  disabled meanwhile), a refused sign-in and a cancelled Checkout. `server/api.test.mjs` holds
  the README's account of deletion and refunds to the kit: a partial refund leaves the support,
  and Delete account leaves only the hour's count of Buy presses naming the account, for two
  hours at most.

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. The repository's check command (`npm run check`, or
`ruff check .` then `pytest -q` in a Python repository) is the gate before a push. To
change a convention, change it in every repository in one pass and update the hashes in
the test.
