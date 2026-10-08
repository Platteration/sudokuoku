# Sudokuoku

Sudoku for iOS, Android and the web with a twist: after every move the board **shifts**,
and you never know which shift is coming. Rows slide, columns slide, the whole
board rotates or flips, every 3×3 box slides its contents. Every shift keeps
the puzzle exactly as solvable as it was, and everything you have entered stays
where it belongs.

Built with [Expo](https://expo.dev) (React Native + TypeScript). One codebase
targets iOS, Android and a website, which plays entirely in the browser: the
puzzle is generated there and the games are kept there, and nothing is sent
anywhere.

## Running it

```bash
npm install
npm start          # then scan the QR code with Expo Go on iOS or Android
npm run ios        # iOS simulator (macOS with Xcode)
npm run android    # Android emulator or a connected device
npm run web        # browser preview
npm run build:web  # the website, in dist/ (see Deploy)
```

### Native builds

Store builds use [EAS Build](https://docs.expo.dev/build/introduction/):
`npx eas build --platform ios` / `--platform android`. Bundle identifiers are
set in `app.json`.

### Deploy

The website is one folder. `npm run build:web` writes it to `dist/`: the page
(`index.html`), the app's bundle under `_expo/static/`, the icon font under
`assets/`, the safety net (`guard.js`), `404.html`, `favicon.ico`,
`robots.txt`, `.well-known/security.txt`, and the three hosting files
`_headers` (Netlify, Cloudflare Pages), `_redirects` (Netlify) and `.htaccess`
(Apache), each of which the other hosts ignore. They come from `public/`, which
the export copies whole. Publish `dist/` as it is: on Netlify or Cloudflare
Pages the build command is `npm run build:web` and the publish directory
`dist`; on Apache copy the folder into the document root (`.htaccess` travels
with it, and takes effect where the server allows it, `AllowOverride All`, and
has `mod_rewrite` and `mod_headers`); on nginx copy it to the
server and include `deploy/nginx.conf`, after setting its `server_name`, `root`
and certificate paths. Never point a server at the checkout.

The build serves from a domain's root. To serve it under a path instead (a
GitHub Pages project site is `https://<user>.github.io/sudokuoku/`), build with
`WEB_BASE_PATH=/sudokuoku npm run build:web`: `app.config.js` turns that into
Expo's `experiments.baseUrl`, which prefixes every address the export writes,
and the build script prefixes the addresses in `public/`'s pages and Apache's
error pages the same way. Without the variable the configuration is `app.json`
exactly, so no native build is affected.

**HTTPS only**, with plain `http://` redirected: the Apache and nginx configs
do it, and Netlify, Cloudflare Pages and GitHub Pages have a switch for it. The
clipboard the challenge sheet copies to needs a secure context.

**Response headers.** The same values are in `public/_headers`,
`public/.htaccess` and `deploy/nginx.conf`. For a host that sends no headers,
the build copies the policy from `_headers` into both pages as a `<meta>`
(less `frame-ancestors`, which a `<meta>` cannot carry), and the referrer
policy is a `<meta>` in both as well. The page template itself carries no
policy, because `npm run web` serves it too, and the dev server's reloading
needs a socket the policy refuses. `src/__tests__/website.test.ts` fails when
any two copies differ, and `npm run test:e2e` plays the game under them in
Chromium:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'; trusted-types 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), autoplay=(), browsing-topics=(), camera=(), clipboard-read=(self), clipboard-write=(self), display-capture=(), encrypted-media=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), storage-access=(), usb=(), xr-spatial-tracking=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Only the site's own script runs, and no script from a string: no inline
script, no eval, and Trusted Types refuse HTML built from a string.
`'unsafe-inline'` is in `style-src` alone, because react-native-web and
expo-font write `<style>` elements while the app runs; without it the board
draws unstyled and the icons are blank. `connect-src 'none'` holds the "no
network code" promise in the browser: a request the app tried to make would be
refused and reported. `frame-ancestors 'none'` and `X-Frame-Options` keep the
game out of other sites' frames. `no-referrer`, because a page address can
carry a challenge code. The bundle and the font carry a content hash in their
names and are cached for a year (`immutable`); everything else is `no-cache`,
revalidated on every load, so a deploy never mixes an old page with a new
bundle.

**GitHub Pages sends no headers.** There the `<meta>` policy applies, but
`frame-ancestors` (which a `<meta>` cannot carry), `X-Frame-Options`, HSTS,
`Permissions-Policy`, the two cross-origin policies, `nosniff` and the cache
rules need a host that sends headers: Netlify, Cloudflare Pages, Apache or
nginx. Pages' branch builds also run Jekyll, which leaves out folders whose
names start with an underscore, `_expo/` among them, so publish there with
GitHub Actions (`actions/upload-pages-artifact`), which serves the folder as it
is. And every project site of an account shares one origin,
`<user>.github.io`: the web build keeps the games, settings and progress in
that origin's `localStorage`, under keys that start `sudokuoku:`, where any
other app published on the origin can read and overwrite them. Give the site a
domain or subdomain of its own, which gives it an origin of its own.

**Not found.** `404.html` is what a wrong address shows, in the Classic look
and with no script; Netlify, Cloudflare Pages and GitHub Pages pick it up by
themselves and the Apache and nginx configs wire it in, also for a folder with
no page of its own. Both configs refuse dotfiles (`.well-known/` excepted), the
hosting files and Expo's `metadata.json`, and `_redirects` does the same on
Netlify; the build leaves `metadata.json` out anyway, since the page never
reads it.

**When something fails.** `guard.js` loads before the bundle and depends on
nothing: when the bundle does not arrive, throws as it starts or draws nothing
within a few seconds, the visitor reads that Sudokuoku could not start and how
to reload, and with JavaScript off a `<noscript>` note says why nothing
happens. The browser cannot vibrate, so the Vibration switch is disabled on the
web with a note saying so; a browser with no share sheet shows the challenge or
result text in a dialog instead; and a `sudokuoku://` challenge link opens the
app, not the site, which is why the invitation carries the bare code to paste
into the challenge sheet.

**Security contact.** `.well-known/security.txt` points at this repository's
issues and `SECURITY.md`. Its `Expires` date (7 October 2027) is at most a year
ahead, as RFC 9116 asks, and the unit suite fails once it has passed.

**Launch checklist**, with `SITE` the site's https address:

```sh
curl -sI http://SITE/ | head -1                    # a 301 to https
curl -sI https://SITE/ | grep -i -E 'content-security|strict-transport|nosniff|frame-options|referrer|permissions|cache-control'
curl -sI https://SITE/.git/HEAD | head -1          # 404
curl -sI https://SITE/_headers | head -1           # 404
curl -s  https://SITE/_expo/ | grep -c 'Page not found'   # 1: the 404 page, not a listing
curl -sI https://SITE/.well-known/security.txt | head -1  # 200
```

Then open the site, play a move, open every sheet, and check that the browser
console shows no `Content Security Policy` line.

## Challenge a friend

Any board can be handed to someone else as a short code or a link. There is no
server involved: the whole challenge travels inside the string. The link is
`sudokuoku://c/<code>`, which opens the app where it is installed; the invite
carries the bare code too, for messengers that do not turn that into a link,
and the challenge sheet takes either one pasted in.

This works because the game is deterministic in a particular way. The puzzle is
`generatePuzzle(createRng(seed), difficulty)`, and the shift that fires after
move *N* comes from `createRng(seed ^ (N * 0x9e3779b1))` — it depends only on
the seed and the move index, never on which cell was filled. So two people on
the same seed meet the same grid **and the same run of shifts**, however
differently they play.

A finished game can also carry your solve as a **ghost**, so the recipient
races your pace and the win screen says who was quicker. Moves are recorded by
*token* rather than position — a token is a cell's stable identity across every
shift — which is what lets a replay survive the board moving underneath it.

Payloads are bit-packed and base64url encoded, so a full 47-move solve is about
170 characters. Each carries an engine revision: if puzzle generation or the
RNG ever changes, old links refuse to open rather than quietly serving a
different board, and a checksum catches a mangled paste.

Two deliberate limits. Challenges always disable the phantom challenge, because
phantom placement depends on the player's own progress and would drift between
the two sides. And results are computed on each device, so a friend's time is
friendly bragging, not an official score — which is why there are no global
leaderboards.

## Accessibility

Because the board rearranges under the player, position alone is not enough to
describe it. Every cell announces its contents as well as its coordinates
("Row 3, column 5, 7, given" / "empty, noted 1, 5 and 7" / "faded and locked
for 3 more moves"), and each shift and each fading digit is announced through
`AccessibilityInfo`, so the movement is not silent. A colourblind-safe High
contrast pack and a Reduce motion control (system, on or off) are in Settings.

## Development

```bash
npm run lint              # eslint (the shared Expo preset, eslint.config.js)
npm run typecheck         # tsc --noEmit
npm test                  # vitest: generator, solver, every shift, phantoms, the game reducer
npm run test:conventions  # the shared repository conventions (CONVENTIONS.md)
npm run check             # all of the above: the gate before a push
npm run test:e2e          # the website: built for /sudokuoku/, served with its own headers, played in Chromium
npm run test:all          # npm test, then npm run test:e2e
```

`npm run test:e2e` builds the website for a sub-path and serves it the way a
host would, sending the headers exactly as `public/_headers` writes them, then
plays the game in Chromium (Playwright): the first-run help, a move and its
shift, a reload that restores the game, the settings and their confirmation, a
challenge sent, copied and pasted, a board solved to the win sheet, and a new
game confirmed. It fails on any policy report, uncaught error, console error or
request outside the site, and then breaks the page on purpose to check the
safety net, the no-JavaScript note and the 404 page.

GitHub Actions runs the same checks plus an Android and web Metro bundle and
the end-to-end suite on every push (`.github/workflows/ci.yml`); a separate job runs
`npm audit --omit=dev --audit-level=high` against the lockfile. `eas.json`
carries development, preview (Android APK) and production build profiles.

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
the free game, the daily in progress, the profile with statistics, XP, badges,
streak freezes and daily history, and the appearance and assistance
preferences, which belong to the player rather than to either game.

## Project layout

```
App.tsx                     entry: safe-area provider + game screen
src/engine/rng.ts           seeded PRNG so games and shifts are reproducible
src/engine/sudoku.ts        grid helpers, solver, uniqueness check, generator
src/engine/transforms.ts    the shift kinds and how they permute the board
src/engine/game.ts          game state + reducer (moves, shifts, phantoms, undo, hints, win)
src/engine/progress.ts      daily challenge, streaks, freezes, XP, levels and badges
src/engine/presets.ts       named rule sets (Zen, Classic, Phantom, Blindfold, Chaos)
src/engine/challenge.ts     shareable boards: encode, decode, ghost replay
src/engine/__tests__/       vitest suites for all of the above
src/components/Board.tsx    two-layer board; cells animate to their new spots
src/components/ui/          shared button layer: Press, Icon, IconButton, Segmented
src/components/ShiftDemo.tsx  auto-playing board that demonstrates each shift kind
src/components/*            number pad, controls, shift banner, sheets
src/screens/GameScreen.tsx  wires the reducer, timer, persistence, profile, free/daily switching and sheets
src/storage.ts              AsyncStorage save/load for both games, the profile and flags
src/theme.tsx               colour packs, ThemeProvider, useStyles
public/                     the website's own files, copied into the build: index.html (the
                            page template), guard.js, 404.html, robots.txt, .well-known/,
                            and the hosting files _headers, _redirects and .htaccess
deploy/nginx.conf           the same hosting rules for nginx
scripts/build-web.mjs       npm run build:web: the export, plus the base path for public/'s pages
app.config.js               WEB_BASE_PATH for a sub-path build; otherwise app.json as it is
e2e/                        the website suite (run.mjs) and the host it serves from (serve.mjs)
```
