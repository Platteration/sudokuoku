/**
 * The website, end to end: build it for a sub-path, serve it with the headers its own _headers
 * file writes, and play it in Chromium under that policy.
 *
 * Bundling proves the app compiles; this proves the site works as a website. It fails on any
 * Content-Security-Policy, Trusted Types or Permissions-Policy report, any uncaught error, any
 * console error, and any request outside the site, while it drives the game the way a visitor
 * does: the first-run help, a move and its shift, a reload that restores the game, the settings
 * sheet with its confirmation, a challenge copied and pasted through the clipboard, a board
 * solved to the win sheet and its result shared, and a new game confirmed. It reads back which
 * browser features the page is allowed. It follows challenge links the way a page on another site
 * could write them, posts the page a message, reloads, wins a linked challenge and reloads again,
 * and pastes text far longer than any challenge. It loads the site from a host that sends no
 * headers, over plain http at a name that is not loopback, and measures which inline styles need
 * style-src's 'unsafe-inline'. Then it breaks the page on purpose to see the safety net
 * (public/guard.js) and the no-JavaScript note, and reads the 404 page.
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
import { serveSite } from './serve.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/sudokuoku';
const OUT = join(root, '.web-build');

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
const HOSTING = ['_headers', '_redirects', '.htaccess'];
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
 * A page whose every policy report, uncaught error, console error and request outside the site
 * lands in `seen`. Violations are reported through a binding, so a report made just before a
 * navigation is not lost with the page.
 */
async function open(context, seen, at = origin) {
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
    if (m.type() === 'error') seen.errors.push(`console.error: ${text.slice(0, 300)} @ ${m.location().url}`);
    else if (/Content.Security.Policy|Trusted.Type|Permissions.Policy|Refused to/i.test(text)) seen.violations.push(`console: ${text.slice(0, 300)}`);
  });
  page.on('request', (r) => {
    if (!r.url().startsWith(`${at}${BASE}/`)) seen.outside.push(r.url());
  });
  page.on('dialog', async (d) => {
    seen.dialogs.push(`${d.type()}: ${d.message()}`);
    await (seen.decline ? d.dismiss() : d.accept());
  });
  return page;
}

/** What a page reported. Its dialogs are accepted, or dismissed while `decline` is set. */
const fresh = () => ({ violations: [], errors: [], outside: [], dialogs: [], decline: false });
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
  await button(page, 'Copy code').click();
  await settle(page);
  const code = await page.evaluate(() => navigator.clipboard.readText());
  check('Copy code puts the challenge on the clipboard', /^[A-Za-z0-9_-]{12,}$/.test(code), code);
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
  report('the game', seen);
  await context.close();

  // A challenge link. The site writes none (an invitation carries the app's own sudokuoku:// link
  // and the bare code), but the page reads its own address for one, so anybody can write one: a
  // page on another site can send its visitors to it. Following it again, or reloading, carries
  // on with the challenge rather than starting it over; a message posted to the window is not a
  // link; and a different challenge asks before it replaces one with moves in it.
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
    await follow(first);
    check('and so does following the same link again', (await until(page, async () => (await stat(page, 'Moves')) === 2)) && (await kept())?.moves === 2);
    // Away from the challenge, with its link still in the address: a message is still not a link.
    await button(page, 'New game').click();
    check('New game leaves the challenge for a free game', await until(page, async () => !(await bodyText(page)).includes('Challenge · ')));
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
    await follow(second);
    const replaced = await kept();
    check('and accepted, the new challenge starts', (await bodyText(page)).includes('Challenge · ') && replaced?.seed !== playing?.seed && (await stat(page, 'Moves')) === 0);

    // Won, the challenge leaves the address: a reload after the win neither puts the visitor back
    // on a fresh copy of the board they finished nor counts another game played.
    const played = () => page.evaluate(() => JSON.parse(localStorage.getItem('sudokuoku:profile:v1') ?? 'null')?.totals?.played);
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
