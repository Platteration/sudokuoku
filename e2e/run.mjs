/**
 * The website, end to end: build it for a sub-path, serve it with the headers its own _headers
 * file writes, and play it in Chromium under that policy.
 *
 * Bundling proves the app compiles; this proves the site works as a website. It fails on any
 * Content-Security-Policy, Trusted Types or Permissions-Policy report, any uncaught error, any
 * console error, and any request outside the site, while it drives the game the way a visitor
 * does: the first-run help, a move and its shift, a reload that restores the game, the settings
 * sheet with its confirmation, a challenge sent, copied and pasted through the clipboard, a board
 * solved to the win sheet and its result shared, and a new game confirmed. It reads back which
 * browser features the page is allowed. It follows the invitation the site wrote in another
 * browser, follows challenge links the way a page on another site could write them, posts the
 * page a message, reloads, leaves a challenge for a free game and reloads, wins a linked challenge
 * and reloads again, and pastes text far longer than any challenge. It loads the site from a host that sends no
 * headers, over plain http at a name that is not loopback, and measures which inline styles need
 * style-src's 'unsafe-inline'. Then it breaks the page on purpose to see the safety net
 * (public/guard.js) and the no-JavaScript note, and reads the 404 page.
 *
 * The host above runs no API, as GitHub Pages and Netlify run none: every load asks api/config
 * once, is answered 404 (Chromium's one console line for it is the one console error excused),
 * and draws no sign-in and no shop. Then the same site is served with its sign-in and shop API
 * beside it (server/kit with server/catalogue.js, as Cloudflare Pages runs
 * functions/api/[[path]].js), its Google and Stripe the fakes of server/fakes.mjs handed to the
 * kit as its `fetch`, and the whole flow is played under the site's policy: sign in (Google's
 * authorize page answered by page.route with the redirect back to the callback), Support this app
 * (Checkout answered the same way), Stripe's signed webhook (and a forged one refused), the
 * thanks, sign out, sign in again, delete the account, a Buy after the session ended in another
 * tab (401: Sign in to buy) and one of what another tab bought (409: Owned, pressed twice at once
 * and asked once, the other buttons waiting), a sign-in that fails, a cancelled Checkout.
 *
 *   npm run test:e2e
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { headersFor, metaPolicy } from '../scripts/headers.mjs';
import catalogue from '../server/catalogue.js';
import { createFakes, envFor, signedDelivery } from '../server/fakes.mjs';
import { createNodeHandler } from '../server/kit/node.js';
import { createMemoryStore } from '../server/kit/store.js';
import { serveSite } from './serve.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/sudokuoku';
const OUT = join(root, '.web-build');

/** A string constant's value, read out of the TypeScript source the bundle was built from. */
function constant(file, name) {
  const m = new RegExp(`export const ${name} =\\s*(?:'([^']+)'|"([^"]+)")`).exec(readFileSync(join(root, file), 'utf8'));
  if (!m) throw new Error(`${file} exports no string ${name}`);
  return m[1] ?? m[2];
}
/** What About says leaves the device: on a site with no api/, and on one that offers sign-in (src/about.ts). */
const PRIVACY_WEB = constant('src/about.ts', 'PRIVACY_WEB');
const PRIVACY_WITH_ACCOUNT = constant('src/about.ts', 'PRIVACY_WITH_ACCOUNT');
const SUPPORTER_THANKS = constant('src/about.ts', 'SUPPORTER_THANKS');

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// --- the build ----------------------------------------------------------------------------

const build = spawnSync(process.execPath, [join(root, 'scripts', 'build-web.mjs'), '--out', OUT], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, WEB_BASE_PATH: BASE },
});
if (build.status !== 0) {
  console.error('The website did not build.');
  process.exit(1);
}

/** Every file under `dir`, dot-folders included, as site paths without the leading slash. */
const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort();

const files = filesUnder(OUT);
const SITE = [
  /^index\.html$/,
  /^404\.html$/,
  /^guard\.js$/,
  /^favicon\.ico$/,
  /^robots\.txt$/,
  /^\.well-known\/security\.txt$/,
  /^_expo\/static\/js\/web\/index-[0-9a-f]{32}\.js$/,
  /^assets\/node_modules\/@expo\/vector-icons\/[\w/-]+\/Ionicons\.[0-9a-f]{32}\.ttf$/,
];
const HOSTING = ['_headers', '_redirects', '.htaccess', '_routes.json'];
check(
  'the build holds the site and the hosting files, and nothing else',
  files.every((f) => HOSTING.includes(f) || SITE.some((p) => p.test(f))) && SITE.every((p) => files.some((f) => p.test(f))) && HOSTING.every((f) => files.includes(f)),
  files.join(', ')
);

const index = readFileSync(join(OUT, 'index.html'), 'utf8');
const policyMeta = metaPolicy(readFileSync(join(OUT, '_headers'), 'utf8'));
for (const page of ['index.html', '404.html']) {
  const metas = [...readFileSync(join(OUT, page), 'utf8').matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/g)].map((m) => m[1]);
  check(
    `${page} carries the policy _headers sends, as its one <meta>, less frame-ancestors and upgrade-insecure-requests`,
    metas.length === 1 && metas[0] === policyMeta && !policyMeta.includes('frame-ancestors') && !policyMeta.includes('upgrade-insecure-requests'),
    metas.join(' | ')
  );
}
const scripts = [...index.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1] ?? '');
check('index.html carries no inline script: every <script> has a src', scripts.length === 2 && scripts.every((a) => /\bsrc="/.test(a)), scripts.join(' | '));
check(
  'index.html loads the safety net before the app',
  /<script src="\/sudokuoku\/guard\.js"><\/script>[\s\S]*<script src="\/sudokuoku\/_expo\/static\/js\/web\/index-[0-9a-f]+\.js" defer><\/script>/.test(index)
);
check(
  'the error pages Apache shows are under the base path',
  readFileSync(join(OUT, '.htaccess'), 'utf8').match(/^ErrorDocument .*$/gm)?.join('|') === 'ErrorDocument 404 /sudokuoku/404.html|ErrorDocument 403 /sudokuoku/404.html'
);
check(
  "Cloudflare Pages' _routes.json runs the API for the API's addresses under the base path, and for nothing else",
  readFileSync(join(OUT, '_routes.json'), 'utf8') === '{"version":1,"include":["/sudokuoku/api/*"],"exclude":[]}\n'
);

// --- the host -----------------------------------------------------------------------------

const site = await serveSite({ dir: OUT, base: BASE });
const { origin } = site;
const home = `${origin}${BASE}/`;

// Cloudflare Pages joins the values of a header that two matching rules set: `no-cache, public, ...`.
const twice = ['/', ...files.map((f) => `/${f}`)].flatMap((path) => headersFor(site.rules, path).duplicates.map((name) => `${path}: ${name}`));
check('_headers sets no header twice for any file the site has', twice.length === 0, twice.join(', '));

const response = await fetch(home);
const policy = headersFor(site.rules, '/').headers;
check('the page is served with the policy _headers writes', response.headers.get('content-security-policy') === policy['content-security-policy'] && !!policy['content-security-policy']);
check('the page is revalidated on every load', response.headers.get('cache-control') === 'no-cache');
const bundlePath = files.find((f) => f.startsWith('_expo/'));
const bundle = await fetch(`${origin}${BASE}/${bundlePath}`);
check('the bundle, whose name is its hash, is cached for a year', bundle.headers.get('cache-control') === 'public, max-age=31536000, immutable');
const missing = await fetch(`${home}no/such/page`);
check('a missing page answers 404 with the site 404 page', missing.status === 404 && (await missing.text()).includes('That page isn’t here'));

/** The request line exactly as written: a browser, and fetch, normalise `..` before sending. */
const rawGet = (line) =>
  new Promise((done) => {
    const socket = connect(site.port, '127.0.0.1', () => socket.write(`GET ${line} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => (received += chunk));
    socket.on('close', () => done(received));
    socket.on('error', () => done(''));
  });
for (const line of [`${BASE}/../package.json`, `${BASE}/%2e%2e/package.json`, `${BASE}/..%2fapp.json`, `${BASE}/%`]) {
  const body = await rawGet(line);
  check(`the test host serves nothing outside the build: ${line}`, /^HTTP\/1\.1 40[04]/.test(body) && !body.includes('"dependencies"') && !body.includes('"expo"'));
}

// --- the browser --------------------------------------------------------------------------

/**
 * A name for the test host that is not loopback. Chromium counts 127.0.0.1 as a secure context
 * even over http; a page at this name is what a LAN preview or a host without its certificate is.
 */
const LAN = 'sudokuoku.test';
const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${LAN} 127.0.0.1`] });
/** The page in use, photographed when the suite stops short. */
let current = null;

/**
 * How many times a page was answered 404 for its own api/config, on the hosts that run no API:
 * Chromium logs each as a console error, the one console error excused (see `open`).
 */
const probes = { count: 0 };

/**
 * A page whose every policy report, uncaught error, console error and request outside the site
 * lands in `seen`. Violations are reported through a binding, so a report made just before a
 * navigation is not lost with the page. `leaves` lists the outside addresses the page may
 * navigate to (Google's authorize page, Stripe's Checkout), each answered by page.route in the
 * browser and never sent; they land in `seen.left`.
 *
 * The one console error excused is Chromium's line for the page's own api/config when it is a
 * 404, as it is on every host that runs no API: matched by the address it is reported at, not by
 * its words, and counted in `probes`.
 */
async function open(context, seen, at = origin, leaves = []) {
  await context.exposeBinding('__violation', (_source, text) => seen.violations.push(text));
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__violation(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline'} at ${e.sourceFile}:${e.lineNumber}`);
    });
  });
  const page = await context.newPage();
  current = page;
  page.on('pageerror', (e) => seen.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && m.location().url === `${at}${BASE}/api/config` && /the server responded with a status of 404/.test(text)) {
      probes.count += 1;
      return;
    }
    if (m.type() === 'error') seen.errors.push(`console.error: ${text.slice(0, 300)} @ ${m.location().url}`);
    else if (/Content.Security.Policy|Trusted.Type|Permissions.Policy|Refused to/i.test(text)) seen.violations.push(`console: ${text.slice(0, 300)}`);
  });
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith(`${at}${BASE}/`)) return;
    if (r.isNavigationRequest() && leaves.some((prefix) => url.startsWith(prefix))) seen.left.push(url);
    else seen.outside.push(url);
  });
  page.on('dialog', async (d) => {
    seen.dialogs.push(`${d.type()}: ${d.message()}`);
    await (seen.decline ? d.dismiss() : d.accept());
  });
  return page;
}

/** What a page reported. Its dialogs are accepted, or dismissed while `decline` is set. */
const fresh = () => ({ violations: [], errors: [], outside: [], left: [], dialogs: [], decline: false });
const settle = (page, ms = 400) => page.waitForTimeout(ms);
/** Whether `test` comes true within `ms`, polled: what the page shows next is not on a fixed clock. */
const until = async (page, test, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(50)) if (await test()) return true;
  return test();
};
const bodyText = (page) => page.locator('body').innerText();
const stat = async (page, label) => Number(new RegExp(`(\\d+)\\s*\\n\\s*${label}\\b`).exec(await bodyText(page))?.[1] ?? NaN);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const emptyCell = (page) => page.getByRole('button', { name: /^Row \d, column \d, empty/ }).first();
/**
 * Closes the sheet titled `title` with its own close button, and waits until it has gone: the
 * last Close in the page can belong to a sheet still sliding out.
 */
const closeSheet = async (page, title) => {
  const heading = page.getByText(title, { exact: true });
  await heading.locator('xpath=following-sibling::*[@aria-label="Close"][1]').click();
  await heading.waitFor({ state: 'hidden', timeout: 5000 });
};
const report = (label, seen, host = site) => {
  check(`${label}: no policy violation`, seen.violations.length === 0, seen.violations.join(' | '));
  check(`${label}: no uncaught error and no console error`, seen.errors.length === 0, seen.errors.join(' | '));
  check(`${label}: no request outside the site`, seen.outside.length === 0 && host.outside.length === 0, [...seen.outside, ...host.outside].join(' | '));
};

try {
  // The detector is not blind: a request the policy forbids, and HTML from a string, are both
  // refused and reported.
  {
    const seen = fresh();
    const context = await browser.newContext();
    const page = await open(context, seen);
    await page.goto(home, { waitUntil: 'load' });
    const html = await page.evaluate(() => {
      const img = document.createElement('img');
      img.src = 'https://example.invalid/pixel.png';
      document.body.append(img);
      try {
        document.body.insertAdjacentHTML('beforeend', '<b>from a string</b>');
        return 'ran';
      } catch {
        return 'refused';
      }
    });
    await settle(page);
    check(
      'the policy is in force: a foreign image and HTML from a string are refused, and reported',
      html === 'refused' && seen.violations.some((v) => v.startsWith('img-src blocked https://example.invalid')) && seen.violations.some((v) => v.startsWith('require-trusted-types-for')),
      `${html}; ${seen.violations.join(' | ')}`
    );
    await context.close();
  }

  // The main flow, as a first-time visitor on a phone.
  const seen = fresh();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await open(context, seen);
  await page.goto(home, { waitUntil: 'load' });
  await page.getByText('How Sudokuoku works').waitFor({ timeout: 15000 });
  check('a first visit opens the help', true);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((f) => `${f.family}:${f.status}`);
  });
  check('the icon font loads under the policy', fonts.includes('ionicons:loaded'), fonts.join(', '));
  // A headless browser fetches no tab icon, which a visible one does, under img-src: so load it
  // the way the tab would.
  const icon = await page.evaluate(
    () =>
      new Promise((done) => {
        const link = document.querySelector('link[rel="icon"]');
        const img = new Image();
        img.onload = () => done(`loaded ${new URL(img.src).pathname}`);
        img.onerror = () => done('refused');
        img.src = link instanceof HTMLLinkElement ? link.href : '';
      })
  );
  check('the tab icon the page names loads under the policy', icon === `loaded ${BASE}/favicon.ico`, String(icon));
  // Permissions-Policy turns off every feature this Chromium knows but the clipboard the challenge
  // sheet copies to and pastes from. Client hints (ch-*) are what the browser tells a server, not
  // something the page can use; a feature Chromium has not heard of is not listed, since naming it
  // is a console warning (web-share, the result card's share sheet, is one on Linux).
  const permissions = await page.evaluate(() => {
    const policy = /** @type {{ allowedFeatures(): string[] } | undefined} */ (Reflect.get(document, 'featurePolicy'));
    return policy ? policy.allowedFeatures().filter((f) => !f.startsWith('ch-')).sort() : null;
  });
  check(
    'Permissions-Policy leaves the page the clipboard and no other feature this Chromium knows',
    JSON.stringify(permissions) === JSON.stringify(['clipboard-read', 'clipboard-write']),
    JSON.stringify(permissions)
  );
  await closeSheet(page, 'How Sudokuoku works');

  await emptyCell(page).click();
  await button(page, 'Enter 5').click();
  check('a move counts', await until(page, async () => (await stat(page, 'Moves')) === 1));
  check('and the board shifts after it', await until(page, async () => (await stat(page, 'Shifts')) >= 1));

  await page.reload({ waitUntil: 'load' });
  await page.getByText('Shifts', { exact: true }).waitFor({ timeout: 15000 });
  check('a reload restores the game in progress', await until(page, async () => (await stat(page, 'Moves')) === 1));
  check('and remembers that the help was seen', !(await page.getByText('How Sudokuoku works').isVisible()));
  await button(page, 'Undo').click();
  check('undo takes the move back', await until(page, async () => (await stat(page, 'Moves')) === 0));

  // Settings: a web visitor reads why Vibration is off rather than flipping a switch that does nothing.
  await button(page, 'Settings').click();
  await settle(page, 600);
  const vibration = page.getByRole('switch', { name: 'Vibration' });
  check('the Vibration switch is disabled on the web', (await vibration.getAttribute('aria-disabled')) === 'true');
  check('and says why', (await bodyText(page)).includes('Browsers cannot vibrate here'));
  const conflicts = page.getByRole('switch', { name: 'Highlight conflicts' });
  const before = await conflicts.getAttribute('aria-checked');
  await conflicts.click();
  await settle(page);
  check('a setting switches', (await conflicts.getAttribute('aria-checked')) !== before);
  // This host runs no API, as GitHub Pages and Netlify run none: api/config was a 404, and the
  // account and the shop do not exist here. About says what is true of the page instead.
  const settingsText = await bodyText(page);
  check(
    'with no API on the host, Settings draws no sign-in and no shop, and About says the games stay in the browser',
    settingsText.includes(PRIVACY_WEB) &&
      !settingsText.includes(PRIVACY_WITH_ACCOUNT) &&
      (await button(page, 'Sign in with Google').count()) === 0 &&
      (await button(page, 'Sign in to buy').count()) === 0 &&
      !/Support this app|Signed in/i.test(settingsText),
    settingsText.slice(-400)
  );
  await button(page, 'Reset to defaults').click();
  await settle(page, 600);
  check('Reset to defaults asks first, in the browser', seen.dialogs.some((d) => d.startsWith('confirm: Reset settings?')));
  check('and puts the setting back', (await conflicts.getAttribute('aria-checked')) === before);
  await closeSheet(page, 'Settings');

  // A challenge: sent (a browser with no share sheet shows the invitation instead), copied out
  // and pasted back in through the clipboard, and solved with hints, cell by cell, through every
  // shift, to the win sheet.
  await button(page, 'Challenge a friend').click();
  await settle(page, 600);
  await button(page, 'Send challenge').click();
  await settle(page, 600);
  check('Send challenge shows the invitation where there is no share sheet', seen.dialogs.some((d) => d.startsWith('alert: I set you a Sudokuoku board.')), seen.dialogs.join(' | '));
  // Sent from the website, the invitation links to the website: this page, at this path, with the
  // code in the fragment, which a static host answers with the page.
  const invitation = seen.dialogs.find((d) => d.startsWith('alert: I set you a Sudokuoku board.'))?.slice('alert: '.length) ?? '';
  const invitationLink = invitation.split('\n').find((line) => /^https?:\/\//.test(line)) ?? '';
  const invited = /#\/c\/([A-Za-z0-9_-]+)$/.exec(invitationLink)?.[1] ?? '';
  check('the invitation links to this site, at its path, with the code in the fragment', invited.length >= 12 && invitationLink === `${home}#/c/${invited}`, invitationLink);
  /** The board the invitation was sent from, as the page stored it. */
  const sent = await page.evaluate(() => JSON.parse(localStorage.getItem('sudokuoku:game:v1') ?? 'null')?.seed);
  await button(page, 'Copy code').click();
  await settle(page);
  const code = await page.evaluate(() => navigator.clipboard.readText());
  check('Copy code puts the challenge on the clipboard', /^[A-Za-z0-9_-]{12,}$/.test(code), code);
  check('and the invitation carries that code twice: in its link, and on its own to paste', invited === code && invitation.trimEnd().endsWith(`\n${code}`), invitation);
  await button(page, 'Paste from clipboard').click();
  await settle(page, 1000);
  check('Paste from clipboard opens that challenge', (await bodyText(page)).includes('Challenge · '));
  // One hint at a time, each waited for: the last one fills the board while the win sheet is
  // still on its way in, so the loop counts empty cells rather than looking for the sheet.
  const empties = page.getByRole('button', { name: /^Row \d, column \d, empty/ });
  for (let i = 0; i < 81 && (await empties.count()) > 0; i += 1) {
    const moves = await stat(page, 'Moves');
    await empties.first().click();
    await button(page, 'Hint').click();
    await until(page, async () => (await stat(page, 'Moves')) === moves + 1);
  }
  await page.getByText('Solved!').waitFor({ timeout: 10000 });
  check('the board can be solved to the win sheet', true);
  await button(page, 'Play again').click();
  await settle(page, 800);

  // Daily and progress, opened and closed.
  await button(page, 'Daily challenge').click();
  await page.getByText('Play today’s daily').waitFor();
  await closeSheet(page, 'Daily challenge');
  await button(page, 'Progress').click();
  await page.getByText('Shifts survived').waitFor();
  await closeSheet(page, 'Progress');

  // A new game over a game in progress is confirmed.
  await emptyCell(page).click();
  await button(page, 'Enter 3').click();
  await settle(page, 800);
  await button(page, 'New game').click();
  await settle(page, 800);
  check('New game over a game in progress asks first', seen.dialogs.some((d) => d.startsWith('confirm: Start a new free game?')));
  check('and starts one', await until(page, async () => (await stat(page, 'Moves')) === 0));

  check('the safety net stays out of the way of a working app', await page.locator('#startup-failed').isHidden());
  check(
    'with no API on the host, each load asked api/config once, and nothing more of api/',
    site.apiRequests.length >= 3 && site.apiRequests.every((r) => r === `GET ${BASE}/api/config`) && site.apiRequests.length === probes.count,
    `${site.apiRequests.join(', ')}; ${probes.count} 404 lines`
  );
  report('the game', seen);
  await context.close();

  // That invitation, followed in another browser: the site at the same path, and the challenge on
  // the board it was sent from. Followed, the link loads the page; one that differed from the page
  // already open only in its fragment would not.
  {
    const seen = fresh();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await open(context, seen);
    const answer = await page.goto(invitationLink, { waitUntil: 'load' });
    check('an invitation from the website opens the site', answer?.status() === 200, String(answer?.status()));
    await page.getByText('How Sudokuoku works').waitFor({ timeout: 15000 });
    await closeSheet(page, 'How Sudokuoku works');
    const opened = () => page.evaluate(() => JSON.parse(localStorage.getItem('sudokuoku:challenge:v1') ?? 'null'));
    check(
      'and the challenge it names, on the board it was sent from',
      (await until(page, async () => (await opened())?.seed === sent)) && (await bodyText(page)).includes('Challenge · ') && (await opened())?.moves === 0,
      JSON.stringify([sent, (await opened())?.seed])
    );
    await button(page, 'Challenge a friend').click();
    check('the challenge sheet says a challenge is being played', await until(page, async () => (await bodyText(page)).includes('You are playing a challenge')));
    await closeSheet(page, 'Challenge a friend');
    // A launch that has to make a new free game while the challenge takes the screen (here the free
    // game's record is unreadable, as anything on the origin can make it) saves that game as it
    // makes it: nothing else would, and every later load would make, and count, another.
    const played = () => page.evaluate(() => JSON.parse(localStorage.getItem('sudokuoku:profile:v1') ?? 'null')?.totals?.played);
    /** The stored free game's seed, or 'unreadable' while the record planted below is still there. */
    const free = () =>
      page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem('sudokuoku:game:v1') ?? 'null')?.seed;
        } catch {
          return 'unreadable';
        }
      });
    const reload = async () => {
      await page.reload({ waitUntil: 'load' });
      await page.getByText('Shifts', { exact: true }).waitFor({ timeout: 15000 });
      await settle(page, 800);
    };
    await page.evaluate(() => localStorage.setItem('sudokuoku:game:v1', '{'));
    await reload();
    const counted = await played();
    const behind = await free();
    await reload();
    check(
      'a free game made behind the challenge is saved as it is made, and the next load counts no game',
      typeof behind === 'number' && (await free()) === behind && (await played()) === counted && (await bodyText(page)).includes('Challenge · '),
      JSON.stringify([behind, await free(), counted, await played()])
    );
    report('an invitation followed', seen);
    await context.close();
  }

  // A challenge link. The site writes them (an invitation sent from it is the page's own address
  // with #/c/<code>), and the page reads its own address for one, so anybody can write one too: a
  // page on another site can send its visitors to it. Following it again, or reloading, carries
  // on with the challenge rather than starting it over; leaving it for another game takes its
  // link out of the address, so a reload shows that game; a message posted to the window is not
  // a link; and a different challenge asks before it replaces one with moves in it.
  {
    const seen = fresh();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const page = await open(context, seen);
    await page.goto(home, { waitUntil: 'load' });
    await page.getByText('How Sudokuoku works').waitFor({ timeout: 15000 });
    await closeSheet(page, 'How Sudokuoku works');
    /** The code the challenge sheet offers for the board on screen. */
    const copyCode = async () => {
      await button(page, 'Challenge a friend').click();
      await button(page, 'Copy code').click();
      await settle(page);
      const text = await page.evaluate(() => navigator.clipboard.readText());
      await page.keyboard.press('Escape');
      await button(page, 'Copy code').waitFor({ state: 'hidden', timeout: 5000 });
      return text;
    };
    const first = await copyCode();
    await button(page, 'New game').click();
    await settle(page, 600);
    const second = await copyCode();
    check('two boards, two challenge codes', /^[A-Za-z0-9_-]{12,}$/.test(first) && /^[A-Za-z0-9_-]{12,}$/.test(second) && first !== second, `${first} ${second}`);
    /** The challenge kept in the one challenge slot, as the page stored it. */
    const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem('sudokuoku:challenge:v1') ?? 'null'));
    /** How many games the profile has counted as played. */
    const played = () => page.evaluate(() => JSON.parse(localStorage.getItem('sudokuoku:profile:v1') ?? 'null')?.totals?.played);
    /** The board as a screen reader hears it, one label per cell. */
    const board = () => page.getByRole('button', { name: /^Row \d, column \d, / }).evaluateAll((cells) => cells.map((c) => c.getAttribute('aria-label')));
    const undoable = async () => (await button(page, 'Undo').getAttribute('aria-disabled')) !== 'true';
    const follow = async (code) => {
      await page.goto(`${home}?/c/${code}`, { waitUntil: 'load' });
      await page.getByText('Shifts', { exact: true }).waitFor({ timeout: 15000 });
      await settle(page, 800);
    };

    await follow(first);
    check('a challenge link opens its challenge', (await bodyText(page)).includes('Challenge · '));
    const empties = page.getByRole('button', { name: /^Row \d, column \d, empty/ });
    for (const n of [1, 2]) {
      await empties.first().click();
      await button(page, 'Hint').click();
      await until(page, async () => (await stat(page, 'Moves')) === n);
    }
    const playing = await kept();
    check('two moves are made in it, and kept', playing?.moves === 2 && playing?.mode === 'challenge', JSON.stringify(playing?.moves));
    const playedBoard = await board();
    const counted = await played();

    await page.evaluate(() => window.postMessage('a message, from anyone', '*'));
    await settle(page, 1000);
    check('a message posted to the page does not start the challenge over', (await stat(page, 'Moves')) === 2 && (await kept())?.moves === 2, `${await stat(page, 'Moves')}`);

    await page.reload({ waitUntil: 'load' });
    await page.getByText('Shifts', { exact: true }).waitFor({ timeout: 15000 });
    check(
      'a reload, which reads the link again, carries on with the challenge',
      (await until(page, async () => (await stat(page, 'Moves')) === 2)) && (await bodyText(page)).includes('Challenge · ') && (await kept())?.seed === playing?.seed,
      `${await stat(page, 'Moves')}`
    );
    check(
      'on the same board, with its moves still to undo, and no game counted for the reload',
      JSON.stringify(await board()) === JSON.stringify(playedBoard) && (await undoable()) && (await played()) === counted,
      JSON.stringify([await undoable(), counted, await played()])
    );
    await follow(first);
    check(
      'and so does following the same link again',
      (await until(page, async () => (await stat(page, 'Moves')) === 2)) && (await kept())?.moves === 2 && (await played()) === counted
    );
    // Left for another game, the challenge keeps its slot and its link leaves the address, so a
    // reload shows the game on screen rather than taking the visitor back to the challenge.
    await button(page, 'New game').click();
    check('New game leaves the challenge for a free game', await until(page, async () => !(await bodyText(page)).includes('Challenge · ')));
    check('and takes its link out of the address', await until(page, async () => page.url() === home), page.url());
    const afterNew = await played();
    await page.reload({ waitUntil: 'load' });
    await page.getByText('Shifts', { exact: true }).waitFor({ timeout: 15000 });
    await settle(page, 800);
    check(
      'a reload then shows the free game, with the challenge kept in its slot and no game counted',
      !(await bodyText(page)).includes('Challenge · ') && (await kept())?.seed === playing?.seed && (await kept())?.moves === 2 && (await played()) === afterNew,
      JSON.stringify([(await kept())?.moves, afterNew, await played()])
    );
    const asked = seen.dialogs.length;
    await page.evaluate(() => window.postMessage('a message, from anyone', '*'));
    await settle(page, 1000);
    check(
      'a message posted to the page does not open the address it was loaded from',
      !(await bodyText(page)).includes('Challenge · ') && seen.dialogs.length === asked && (await kept())?.moves === 2,
      seen.dialogs.slice(asked).join(' | ')
    );

    seen.decline = true;
    await follow(second);
    seen.decline = false;
    check('a link to another challenge asks before it replaces this one', seen.dialogs.some((d) => d.startsWith('confirm: Start a new challenge?')), seen.dialogs.join(' | '));
    const declined = await kept();
    check('and declined, the challenge in progress is kept', declined?.seed === playing?.seed && declined?.moves === 2, JSON.stringify([declined?.seed, declined?.moves]));
    // The address still names the declined challenge here. In a browser the 'url' event is every
    // message posted to the window, reported with that address, so were the page to listen for it
    // a message would ask again.
    const declinedAsked = seen.dialogs.length;
    await page.evaluate(() => window.postMessage('a message, from anyone', '*'));
    await settle(page, 1000);
    check(
      'a message posted to the page does not offer the link in its address again',
      seen.dialogs.length === declinedAsked && (await kept())?.moves === 2,
      seen.dialogs.slice(declinedAsked).join(' | ')
    );
    await follow(second);
    const replaced = await kept();
    check('and accepted, the new challenge starts', (await bodyText(page)).includes('Challenge · ') && replaced?.seed !== playing?.seed && (await stat(page, 'Moves')) === 0);

    // Won, the challenge leaves the address: a reload after the win neither puts the visitor back
    // on a fresh copy of the board they finished nor counts another game played.
    for (let i = 0; i < 81 && (await empties.count()) > 0; i += 1) {
      const moves = await stat(page, 'Moves');
      await empties.first().click();
      await button(page, 'Hint').click();
      await until(page, async () => (await stat(page, 'Moves')) === moves + 1);
    }
    await page.getByText('Solved!').waitFor({ timeout: 10000 });
    const won = await played();
    check('a challenge from a link, won, leaves the address', page.url() === home, page.url());
    await page.reload({ waitUntil: 'load' });
    await page.getByText('Shifts', { exact: true }).waitFor({ timeout: 15000 });
    await settle(page, 800);
    check(
      'and a reload after the win neither starts it again nor counts another game',
      !(await bodyText(page)).includes('Challenge · ') && (await kept()) === null && (await played()) === won,
      JSON.stringify([await stat(page, 'Moves'), (await kept())?.seed ?? null, won, await played()])
    );

    // A challenge pasted over the one a link opened takes the link out of the address too, or a
    // reload would read the link and replace the pasted challenge with it.
    await follow(first);
    check('a link opens its challenge again once the last one was won', (await bodyText(page)).includes('Challenge · ') && page.url() !== home);
    await page.evaluate((text) => navigator.clipboard.writeText(text), second);
    await button(page, 'Challenge a friend').click();
    await button(page, 'Paste from clipboard').click();
    await settle(page, 1000);
    const pasted = await kept();
    check('a pasted challenge takes the slot, and the link leaves the address', pasted?.seed === replaced?.seed && page.url() === home, `${page.url()} ${pasted?.seed}`);
    const before = await played();
    const dialogs = seen.dialogs.length;
    await page.reload({ waitUntil: 'load' });
    await page.getByText('Shifts', { exact: true }).waitFor({ timeout: 15000 });
    await settle(page, 800);
    check(
      'and a reload keeps the pasted challenge rather than reading the old link',
      (await kept())?.seed === pasted?.seed && (await played()) === before && seen.dialogs.length === dialogs,
      JSON.stringify([(await kept())?.seed, before, await played(), seen.dialogs.slice(dialogs)])
    );
    // With no link in the address, the challenge on screen when the page was left is the one it
    // shows again: nothing else in the app returns to a challenge.
    check('on screen, as it was when the page was left', await until(page, async () => (await bodyText(page)).includes('Challenge · ')));
    report('challenge links', seen);
    await context.close();
  }

  // A long paste. Paste from clipboard reads whatever is there, and a page can put anything there
  // when its text is copied: a run of `?` with a line after it held the page for 13 seconds in the
  // pattern that took a link apart, and a megabyte drawn in the field for as long again.
  {
    const seen = fresh();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const page = await open(context, seen);
    await page.goto(home, { waitUntil: 'load' });
    await page.getByText('How Sudokuoku works').waitFor({ timeout: 15000 });
    await closeSheet(page, 'How Sudokuoku works');
    await button(page, 'Challenge a friend').click();
    await button(page, 'Paste from clipboard').waitFor();
    // How long the page went without running a timer that asks every 50 ms, from here on.
    await page.evaluate(() => {
      let last = performance.now();
      window.__stalls = [];
      setInterval(() => {
        const now = performance.now();
        window.__stalls.push(now - last);
        last = now;
      }, 50);
    });
    for (const [label, text] of [
      ['100,000 question marks and a second line', `${'?'.repeat(100000)}\nx`],
      ['a megabyte without a break', `${'A'.repeat(1000000)}\nx`],
    ]) {
      await page.evaluate((t) => navigator.clipboard.writeText(t), text);
      await page.getByLabel('Challenge code').fill(''); // which clears the last paste's error
      await page.evaluate(() => (window.__stalls.length = 0));
      await button(page, 'Paste from clipboard').click();
      await settle(page, 1500);
      // An evaluate waits for the page, and this one for the timer's next turn as well, so a
      // stall in progress is measured whole.
      const longest = await page.evaluate(
        () => new Promise((done) => setTimeout(() => done(Math.round(Math.max(0, ...window.__stalls))), 200))
      );
      const shown = await bodyText(page);
      // What the sheet said instead, when it did not refuse: the read failed, a challenge opened, or nothing.
      const instead = ['Could not read the clipboard.', 'Challenge · '].find((t) => shown.includes(t)) ?? 'no message';
      check(
        `a paste of ${label} is refused without holding up the page`,
        longest < 1000 && shown.includes('That challenge code is too long to open safely.'),
        `longest stall ${longest} ms${shown.includes('That challenge code is too long to open safely.') ? '' : `; the sheet showed ${instead}, the field holds ${(await page.getByLabel('Challenge code').inputValue().catch(() => '')).length} characters`}`
      );
    }
    report('a long paste', seen);
    await context.close();
  }

  // The site with its sign-in and shop API beside it, as Cloudflare Pages serves it with
  // functions/api/[[path]].js: server/kit with this app's catalogue, answering <base>/api/*, its
  // Google and Stripe the fakes it is handed as its fetch. APP_URL is this host's own address, as
  // on a deployment. The whole flow, under the site's policy, as a visitor on a phone.
  {
    const fakes = await createFakes();
    let handler = null;
    const shop = await serveSite({ dir: OUT, base: BASE, api: (req, res) => handler(req, res) });
    const shopHome = `${shop.origin}${BASE}/`;
    const logs = [];
    handler = createNodeHandler({ catalogue, env: envFor(shopHome), store: createMemoryStore(), fetch: fakes.fetch, log: (level, message) => logs.push(`${level}: ${message}`) });
    check('the API beside the site has sign-in and the shop on', handler.features.signIn && handler.features.shop);
    const apiConfig = await fetch(`${shopHome}api/config`);
    check(
      "api/ answers with the API's own headers, not the site's",
      apiConfig.headers.get('content-security-policy') === "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" &&
        apiConfig.headers.get('referrer-policy') === 'no-referrer' &&
        apiConfig.headers.get('x-content-type-options') === 'nosniff' &&
        apiConfig.headers.get('cross-origin-resource-policy') === 'same-origin' &&
        apiConfig.headers.get('cache-control') === 'public, max-age=60' &&
        !apiConfig.headers.has('permissions-policy'),
      [...apiConfig.headers].map(([name, value]) => `${name}: ${value}`).join(' | ')
    );

    const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?';
    const CHECKOUT = 'https://checkout.stripe.com/c/pay/';
    const seen = fresh();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
    const page = await open(context, seen, shop.origin, [GOOGLE, CHECKOUT]);
    // Google's side. Playwright routes no redirect's target, so the browser would follow the kit's
    // 302 to accounts.google.com for real: the kit's own answer to api/auth/google/start, its
    // sign-in cookie included, reaches the browser as a Refresh to the same address instead. The
    // browser then navigates to Google's authorize URL itself, and the route below answers it as
    // Google does, with a 302 to the callback (fakes.consent checks the URL as Google would), or
    // with Google's error=access_denied when refusing. The callback arrives from that cross-site
    // hop, as it does from Google, so the cookie's SameSite is what a real sign-in meets.
    const answered = [];
    const startProblems = [];
    let refuse = false;
    await page.route(
      (url) => url.href.startsWith(`${shopHome}api/auth/google/start?`),
      async (route) => {
        const response = await route.fetch({ maxRedirects: 0 });
        const { location = '', ...headers } = response.headers();
        if (response.status() !== 302 || !location.startsWith(GOOGLE)) startProblems.push(`${response.status()} ${location}`);
        await route.fulfill({ status: 200, headers: { ...headers, refresh: `0;url=${location}` }, body: '' });
      }
    );
    await page.route('https://accounts.google.com/**', async (route) => {
      const url = route.request().url();
      answered.push(url);
      let back;
      if (refuse) {
        const asked = new URL(url).searchParams;
        back = new URL(asked.get('redirect_uri'));
        back.searchParams.set('error', 'access_denied');
        back.searchParams.set('state', asked.get('state'));
      } else {
        back = fakes.consent(url, { sub: '1001', email: 'ada@example.com' });
      }
      await route.fulfill({ status: 302, headers: { location: back.href } });
    });
    // Stripe's side: Checkout, paid at once, sends the visitor back to the success_url.
    const checkouts = [];
    await page.route('https://checkout.stripe.com/**', (route) => {
      const url = route.request().url();
      answered.push(url);
      checkouts.push(url);
      return route.fulfill({ status: 302, headers: { location: `${shopHome}?purchase=success` } });
    });

    const text = (t) => page.getByText(t, { exact: true });
    const onGame = () => page.getByText('Shifts', { exact: true }).waitFor({ timeout: 15000 });
    const openSettings = async () => {
      await button(page, 'Settings').click();
      await button(page, 'Reset to defaults').waitFor();
    };
    /** Presses `name`, waits for the page to leave through `through` and to load again at `back`. */
    const leaveAndReturn = async (name, through, back = shopHome) => {
      const left = page.waitForRequest((r) => r.url().startsWith(through), { timeout: 15000 });
      const returned = page.waitForRequest((r) => r.url() === back && r.isNavigationRequest(), { timeout: 15000 });
      await button(page, name).click();
      await left;
      await returned;
      await page.waitForLoadState('load');
      await onGame();
    };
    const callback = `${shopHome}api/auth/google/callback`;
    const thanked = async () => (await text(SUPPORTER_THANKS).count()) === 1;
    /** The webhook Stripe sends once the Checkout Session `url` names is paid, signed with `secret`. */
    const deliver = (delivery) =>
      fetch(`${shopHome}api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': delivery.signature }, body: delivery.body });

    try {
      await page.goto(shopHome, { waitUntil: 'load' });
      await page.getByText('How Sudokuoku works').waitFor({ timeout: 15000 });
      await closeSheet(page, 'How Sudokuoku works');
      await openSettings();
      await button(page, 'Sign in with Google').waitFor();
      check(
        'a site that offers sign-in: Settings shows the Account and Support this app, priced, and Sign in to buy',
        (await text('Account').count()) === 1 &&
          (await text('Support this app').count()) === 1 &&
          (await text('€3.00').count()) === 1 &&
          (await button(page, 'Sign in to buy').count()) === 1 &&
          (await button(page, 'Buy').count()) === 0 &&
          !(await thanked())
      );
      check('and About says what signing in and paying tell the site', (await text(PRIVACY_WITH_ACCOUNT).count()) === 1);

      await leaveAndReturn('Sign in to buy', callback);
      await openSettings();
      await text('Signed in as ada@example.com').waitFor();
      check('signed in with Google, the visitor is named, and nothing is held yet', (await button(page, 'Buy').count()) === 1 && !(await thanked()));

      await leaveAndReturn('Buy', CHECKOUT, `${shopHome}?purchase=success`);
      check('Buy leaves for Stripe’s Checkout, once, and comes back', checkouts.length === 1, checkouts.join(' | '));
      check('back from Checkout, the page takes ?purchase=success out of its address', await until(page, async () => (await page.evaluate(() => location.search)) === ''), page.url());
      // Back from Checkout nothing is granted: only Stripe's signed word grants it, and one signed
      // with another secret is refused.
      const forged = await deliver(signedDelivery(fakes.paid(checkouts[0]), { secret: 'whsec_notThisEndpointsSecret00' }));
      const signed = await deliver(signedDelivery(fakes.paid(checkouts[0])));
      check('a webhook signed with another secret is refused, and Stripe’s is taken', forged.status === 400 && signed.status === 200, `${forged.status} ${signed.status}`);
      // The page asks api/me until the payment shows, then says so at the top of the game.
      const thanks = await text('Thank you — Support this app is unlocked.').waitFor({ timeout: 20000 }).then(
        () => true,
        () => false
      );
      check('the page asks again until the support shows, and thanks the visitor once it does', thanks);
      await button(page, 'Dismiss').click();
      check('Dismiss takes the notice away', await until(page, async () => (await page.getByRole('alert').count()) === 0));
      await openSettings();
      await text(SUPPORTER_THANKS).waitFor();
      check('About thanks the supporter, and the support shows Owned', (await text('Owned').count()) === 1 && (await button(page, 'Buy').count()) === 0);

      // Signing out takes the thanks away; the support is the account's, so signing in brings it back.
      await button(page, 'Sign out').click();
      await button(page, 'Sign in with Google').waitFor();
      check('Sign out signs out, and the thanks goes with it', !(await thanked()));
      await leaveAndReturn('Sign in with Google', callback);
      await openSettings();
      await text(SUPPORTER_THANKS).waitFor();
      check('signed in again, the support is still the account’s', true);

      // Deleting the account takes the support with it, after asking.
      const asked = seen.dialogs.length;
      await button(page, 'Delete account').click();
      await button(page, 'Sign in with Google').waitFor();
      check(
        'Delete account asks first, says what goes with it, and deletes',
        seen.dialogs.length === asked + 1 && /^confirm: Delete account\?\n\nThis deletes your account on this site, and your support with it/.test(seen.dialogs[asked] ?? '') && !(await thanked()),
        seen.dialogs.slice(asked).join(' | ')
      );
      await leaveAndReturn('Sign in with Google', callback);
      await openSettings();
      await text('Signed in as ada@example.com').waitFor();
      check('signed in after deleting, nothing is held', (await button(page, 'Buy').count()) === 1 && !(await thanked()));

      // A Buy the page is behind on. The answer has nothing of its own to say (checkoutNote), so the
      // card drawn again from api/me is the visitor's answer. Chromium logs each refused fetch as a
      // console error: that one line is excused, by its words and its address.
      const excuse = (status) => {
        const line = `console.error: Failed to load resource: the server responded with a status of ${status} @ ${shopHome}api/checkout`;
        const found = seen.errors.filter((e) => e === line).length;
        seen.errors = seen.errors.filter((e) => e !== line);
        return found;
      };
      /** A request the page itself makes to its api/, as another tab of the site would. */
      const fromPage = (method, route, body = null) =>
        page.evaluate(
          async ([m, r, b]) => {
            const answer = await fetch(`api/${r}`, { method: m, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
            return { status: answer.status, body: answer.status === 200 ? await answer.json() : null };
          },
          [method, route, body]
        );
      // Signed out in another tab: Buy is answered 401, and the card asks the visitor to sign in.
      check('signing out in another tab', (await fromPage('POST', 'auth/logout')).status === 204);
      await button(page, 'Buy').click();
      await button(page, 'Sign in to buy').waitFor();
      check(
        'a Buy after the session ended draws the card again: Sign in to buy, Sign in with Google, nothing else said',
        (await button(page, 'Sign in with Google').count()) === 1 && (await button(page, 'Buy').count()) === 0 && (await text('Signed in as ada@example.com').count()) === 0 && (await text('The shop could not be reached. Try again.').count()) === 0
      );
      check('and Chromium logged the 401, once', excuse('401 (Unauthorized)') === 1, seen.errors.join(' | '));
      await leaveAndReturn('Sign in with Google', callback);
      await openSettings();
      await text('Signed in as ada@example.com').waitFor();
      // Bought in another tab, its webhook in: Buy is answered 409, and the card says Owned. The
      // Buy is held at the API meanwhile, pressed twice in one moment (before React draws again).
      const elsewhere = await fromPage('POST', 'checkout', { product: 'supporter' });
      check('buying in another tab', elsewhere.status === 200 && typeof elsewhere.body?.url === 'string', JSON.stringify(elsewhere));
      check('and Stripe’s webhook for it is taken', (await deliver(signedDelivery(fakes.paid(elsewhere.body.url)))).status === 200);
      let release = () => {};
      const held = new Promise((resolve) => (release = resolve));
      const buys = [];
      await page.route(`${shopHome}api/checkout`, async (route) => {
        buys.push(route.request().method());
        await held;
        await route.continue();
      });
      await button(page, 'Buy').evaluate((el) => {
        el.click();
        el.click();
      });
      await until(page, async () => buys.length > 0);
      await settle(page);
      const disabled = async (name) => (await button(page, name).getAttribute('aria-disabled')) === 'true';
      check('two presses of Buy in one moment ask api/checkout once', buys.length === 1, buys.join(' '));
      check('while the Buy is under way, Sign out and Delete account wait for it', (await disabled('Sign out')) && (await disabled('Delete account')));
      release();
      await text('Owned').waitFor();
      await page.unroute(`${shopHome}api/checkout`);
      check(
        'a Buy of what was bought meanwhile draws the card again: Owned, the thanks, nothing else said, and nothing left for Checkout',
        (await thanked()) && (await button(page, 'Buy').count()) === 0 && (await text('The shop could not be reached. Try again.').count()) === 0 && checkouts.length === 1
      );
      check('and Chromium logged the 409, once', excuse('409 (Conflict)') === 1, seen.errors.join(' | '));

      // A sign-in Google refuses comes back to the site, which says so once and cleans the address.
      await button(page, 'Sign out').click();
      await button(page, 'Sign in with Google').waitFor();
      refuse = true;
      await leaveAndReturn('Sign in with Google', callback, `${shopHome}?signin=failed`);
      await text("Sign-in didn't complete.").waitFor();
      check('a sign-in that did not complete says so, and leaves the address clean', (await page.evaluate(() => location.search)) === '');
      await button(page, 'Dismiss').click();
      check('and Dismiss takes it away', await until(page, async () => (await text("Sign-in didn't complete.").count()) === 0));
      // A cancelled Checkout only cleans the address.
      await page.goto(`${shopHome}?purchase=cancelled`, { waitUntil: 'load' });
      await onGame();
      check(
        'a cancelled Checkout says nothing, and leaves the address clean',
        (await until(page, async () => (await page.evaluate(() => location.search)) === '')) && (await page.getByRole('alert').count()) === 0
      );
    } finally {
      await context.close();
    }
    // Every page that left the site went to Google's authorize URL or Stripe's Checkout, each
    // answered in the browser; nothing reached either, and the fakes were asked nothing else.
    check('the kit sent the browser to Google’s authorize URL each time', startProblems.length === 0, startProblems.join(' | '));
    check(
      'the page left the site only for Google and Checkout, each answered in the browser',
      JSON.stringify(seen.left) === JSON.stringify(answered) && answered.filter((u) => u.startsWith(GOOGLE)).length === 5 && checkouts.length === 1,
      seen.left.join(' | ')
    );
    check('the fakes were asked nothing they do not serve, and the kit warned of nothing', fakes.unexpected.length === 0 && logs.length === 0, [...fakes.unexpected, ...logs].join(' | '));
    check('the webhook reached the API', shop.apiRequests.includes(`POST ${BASE}/api/webhooks/stripe`));
    report('sign-in and support', seen, shop);
    await shop.close();
  }

  // A host that sends no headers (GitHub Pages sends none of these), over plain http, at a name
  // that is not loopback: a LAN preview of the built folder, or a host before its certificate.
  // The pages' <meta> is the whole policy there. With upgrade-insecure-requests in it the browser
  // asked for guard.js and the bundle over https from a port that speaks http, both failed, and
  // the page stayed blank without the safety net's note, the net having been refused first.
  {
    const bare = await serveSite({ dir: OUT, base: BASE, transform: () => ({}) });
    const at = `http://${LAN}:${bare.port}`;
    const seen = fresh();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await open(context, seen, at);
    const failed = [];
    page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
    const answer = await page.goto(`${at}${BASE}/`, { waitUntil: 'load' });
    check(
      'a host with no headers, over plain http: the page is not a secure context and its <meta> is the only policy',
      !answer?.headers()['content-security-policy'] && (await page.evaluate(() => window.isSecureContext)) === false
    );
    const drew = await page.getByText('How Sudokuoku works').waitFor({ timeout: 15000 }).then(
      () => true,
      () => false
    );
    check('and there the game draws, every request answered', drew && failed.length === 0, failed.join(' | '));
    await settle(page, 800);
    check(
      'and there, with no API, the page asked api/config once and drew no sign-in',
      JSON.stringify(bare.apiRequests) === JSON.stringify([`GET ${BASE}/api/config`]) && !(await bodyText(page)).includes('Sign in with Google'),
      bare.apiRequests.join(', ')
    );
    report('plain http with no headers', seen, bare);
    await context.close();
    await bare.close();
  }

  // Why style-src carries 'unsafe-inline'. Served with the empty-string hash in its place, the
  // browser refuses two <style> elements and no more: index.html's reset, fixed text a file could
  // carry, and expo-font's @font-face for the icon font, whose text holds the font's address (the
  // base path and the font's content hash), so its hash changes with each deployment path and
  // each icon font, and the copies of the policy written by hand (nginx.conf, the README) could
  // not follow it. react-native-web's stylesheet is empty and filled through insertRule, which
  // the empty-string hash covers. When this check changes, so has the reason in public/_headers.
  {
    const EMPTY = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";
    const strict = await serveSite({
      dir: OUT,
      base: BASE,
      transform: (headers) => ({ ...headers, 'content-security-policy': headers['content-security-policy'].replace("'unsafe-inline'", `${EMPTY} 'report-sample'`) }),
    });
    const context = await browser.newContext();
    const refused = [];
    await context.exposeBinding('__refused', (_source, text) => refused.push(text));
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => window.__refused(`${e.effectiveDirective}: ${e.sample}`));
    });
    const page = await context.newPage();
    await page.goto(`${strict.origin}${BASE}/`, { waitUntil: 'load' });
    await page.getByText('How Sudokuoku works').waitFor({ timeout: 15000 });
    await settle(page, 800);
    refused.sort();
    check(
      "style-src needs 'unsafe-inline' for the icon font's @font-face and the page's reset, and for nothing else",
      refused.length === 2 && refused[0].startsWith('style-src-elem: @font-face{font-family:"ionicons"') && refused[1].startsWith('style-src-elem: html,'),
      refused.join(' | ')
    );
    await context.close();
    await strict.close();
  }

  // The safety net: a bundle that never arrives, one that throws as it starts, and one that
  // runs without drawing anything (as one the policy refused would, with no error to hear).
  // The first two are heard at once; the third only when the guard's grace period runs out.
  for (const [label, handle, within] of [
    ['a bundle that does not load', (route) => route.abort(), 2000],
    ['a bundle that throws as it starts', (route) => route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("broken on purpose");' }), 2000],
    ['a bundle that runs and draws nothing', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }), 10000],
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/_expo/static/js/web/*.js', handle);
    await page.goto(home, { waitUntil: 'load' });
    const note = page.locator('#startup-failed');
    await note.waitFor({ state: 'visible', timeout: within }).catch(() => undefined);
    check(`${label}: the visitor reads that Sudokuoku could not start`, (await note.isVisible()) && (await note.innerText()).includes('Sudokuoku could not start'));
    await context.close();
  }
  {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(home, { waitUntil: 'load' });
    check('with JavaScript off, the visitor reads why nothing happens', (await bodyText(page)).includes('Sudokuoku needs JavaScript'));
    await context.close();
  }

  // The 404 page, at an address deeper than the site's root.
  {
    const seen = fresh();
    const context = await browser.newContext();
    const page = await open(context, seen);
    const wrong = `${home}c/not-a-page`;
    const answer = await page.goto(wrong, { waitUntil: 'load' });
    // Chromium logs the page's own 404 status as a console error; that one is the point here.
    const own = `console.error: Failed to load resource: the server responded with a status of 404 (Not Found) @ ${wrong}`;
    check('Chromium reports the 404 status, and nothing else', seen.errors.filter((e) => e === own).length === 1, seen.errors.join(' | '));
    seen.errors = seen.errors.filter((e) => e !== own);
    check('a wrong address shows the 404 page with a 404 status', answer?.status() === 404 && (await bodyText(page)).includes('That page isn’t here'));
    const link = page.getByRole('link', { name: 'Open Sudokuoku' });
    check('its link leads to the site, not to the domain', (await link.getAttribute('href')) === `${BASE}/`);
    const looks = await page.evaluate(() => getComputedStyle(document.querySelector('main') ?? document.body).borderRadius);
    check('it is drawn in the app’s look', looks === '16px', looks);
    await link.click();
    await page.getByText('How Sudokuoku works').waitFor({ timeout: 15000 });
    check('and the link opens the game', page.url() === home);
    report('the 404 page', seen);
    await context.close();
  }
} catch (error) {
  check('the suite ran to the end', false, error instanceof Error ? error.message.split('\n').slice(0, 3).join(' ') : String(error));
  const shot = join(OUT, 'failure.png');
  if (current && (await current.screenshot({ path: shot }).then(() => true, () => false))) console.error(`The page as it stood: ${shot}`);
} finally {
  await browser.close();
  await site.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nThe website works under its own policy.');
