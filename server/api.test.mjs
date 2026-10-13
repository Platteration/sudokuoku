// @ts-check
// Sudokuoku's sign-in and shop API as the website deploys it: server/catalogue.js through
// server/kit, by both ways in (functions/api/[[path]].js on Cloudflare Pages, server/start.mjs on
// a host of its own), with a fake Google and a fake Stripe handed to the kit through its `fetch`
// (server/fakes.mjs), never through a variable that names another host. Run by `npm test`
// (`node --test server/kit/selftest.mjs server/api.test.mjs`) before the vitest suites.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import catalogue from './catalogue.js';
import { AMOUNT, PRICE, createFakes, envFor, signedDelivery } from './fakes.mjs';
import { createApp, priceVariable, validateCatalogue } from './kit/app.js';
import { kvStore, pagesHandler } from './kit/cloudflare.js';
import { start } from './start.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (/** @type {string} */ file) => fs.readFileSync(path.join(root, file), 'utf8');
const ENTRY = 'functions/api/[[path]].js';

/** What no test here may do: reach the network. The fakes are injected instead. */
const realFetch = globalThis.fetch;
/** @type {string[]} */
const escaped = [];
before(() => {
  globalThis.fetch = async (input) => {
    escaped.push(String(input));
    throw new Error(`a test reached for the network: ${String(input)}`);
  };
});
after(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(escaped, []);
});

describe('the catalogue', () => {
  it('sells one "Support this app" payment, granting supporter, and nothing else', () => {
    const checked = validateCatalogue(catalogue);
    assert.equal(checked.app, 'sudokuoku');
    assert.equal(checked.name, 'Sudokuoku');
    assert.deepEqual(
      checked.products.map((p) => [p.id, p.name, p.mode, p.grants]),
      [['supporter', 'Support this app', 'payment', 'supporter']],
    );
    assert.equal(priceVariable('supporter'), 'STRIPE_PRICE_SUPPORTER');
    // The page asks for that product and reads that entitlement (src/accountModel.ts).
    const model = read('src/accountModel.ts');
    assert.match(model, /^export const SUPPORTER_PRODUCT = 'supporter';$/m);
    assert.match(model, /^export const SUPPORTER_ENTITLEMENT = 'supporter';$/m);
  });

  it('is what the API is built from, and the fakes are not', () => {
    for (const file of ['server/start.mjs', 'server/catalogue.js', ENTRY]) {
      for (const line of read(file).match(/^import .*$/gm) ?? []) assert.doesNotMatch(line, /fakes|test/, `${file} imports nothing of the tests`);
    }
  });

  it('is read as an ES module by Node, which server/package.json says it is', () => {
    // Without it Node has to guess, and says so (MODULE_TYPELESS_PACKAGE_JSON) on every start.
    assert.deepEqual(JSON.parse(read('server/package.json')), { type: 'module' });
  });
});

/** A Workers KV namespace in memory, as much of one as the kit uses. */
const kv = () => {
  /** @type {Map<string, string>} */
  const data = new Map();
  return {
    data,
    get: async (/** @type {string} */ key) => (data.has(key) ? JSON.parse(data.get(key) ?? 'null') : null),
    put: async (/** @type {string} */ key, /** @type {string} */ value) => void data.set(key, value),
    delete: async (/** @type {string} */ key) => void data.delete(key),
  };
};

describe('Cloudflare Pages: functions/api/[[path]].js', () => {
  it("is the kit's three-line entry with this app's catalogue", () => {
    assert.equal(
      read(ENTRY),
      [
        "import { pagesHandler } from '../../server/kit/cloudflare.js';",
        "import catalogue from '../../server/catalogue.js';",
        'export const onRequest = pagesHandler(catalogue);',
        '',
      ].join('\n'),
    );
  });

  it('loads, and answers api/config with nothing on when no variable is set', () => {
    // The entry itself, imported in a process of its own: Node reads it as an ES module by its
    // syntax (the repository's package.json names no type), which is all Cloudflare's bundler
    // needs too, and the warning it prints for that is left in that process.
    const script = [
      `const { onRequest } = await import(${JSON.stringify(pathToFileURL(path.join(root, ENTRY)).href)});`,
      'const data = new Map();',
      'const KIT_STORE = { get: async (k) => data.get(k) ?? null, put: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };',
      "const answer = await onRequest({ request: new Request('https://sudokuoku.example/api/config'), env: { KIT_STORE } });",
      'const me = await onRequest({ request: new Request(\'https://sudokuoku.example/api/me\'), env: { KIT_STORE } });',
      "console.log(JSON.stringify({ type: typeof onRequest, status: answer.status, body: await answer.json(), cache: answer.headers.get('cache-control'), me: me.status, writes: data.size }));",
    ].join('\n');
    const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), {
      type: 'function',
      status: 200,
      body: { auth: { google: false }, shop: { products: [] } },
      cache: 'public, max-age=60',
      me: 404,
      writes: 0,
    });
  });

  const onRequest = pagesHandler(catalogue);
  const call = (/** @type {string} */ url, /** @type {Record<string, unknown>} */ env) => onRequest({ request: new Request(url), env });

  it('answers every other route with a 404 while nothing is configured', async () => {
    const env = { KIT_STORE: kv() };
    for (const route of ['me', 'auth/google/start', 'auth/google/callback', 'auth/logout', 'checkout', 'portal', 'webhooks/stripe', 'nothing']) {
      assert.equal((await call(`https://sudokuoku.example/api/${route}`, env)).status, 404, route);
    }
  });

  it('starts a sign-in towards Google once sign-in is configured, and sells nothing without Stripe', async () => {
    const { STRIPE_SECRET_KEY: _key, STRIPE_WEBHOOK_SECRET: _hook, STRIPE_PRICE_SUPPORTER: _price, ...signIn } = envFor('https://sudokuoku.example/');
    const env = { ...signIn, KIT_STORE: kv() };
    assert.deepEqual(await (await call('https://sudokuoku.example/api/config', env)).json(), { auth: { google: true }, shop: { products: [] } });
    const started = await call('https://sudokuoku.example/api/auth/google/start?return=%2F', env);
    assert.equal(started.status, 302);
    const google = new URL(started.headers.get('location') ?? '');
    assert.equal(`${google.origin}${google.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(google.searchParams.get('redirect_uri'), 'https://sudokuoku.example/api/auth/google/callback');
    assert.match(started.headers.get('set-cookie') ?? '', /^__Host-sudokuoku-oauth=[^;]+; .*HttpOnly/);
    assert.deepEqual(escaped, []);
  });
});

describe('a host of its own: server/start.mjs through the Node adapter', () => {
  // The public address is the proxy's (deploy/nginx.conf), not the loopback port the API listens
  // on: the kit takes every absolute URL from APP_URL, and the origin the CSRF gate wants.
  const APP_URL = 'https://sudokuoku.example/';
  const ORIGIN = 'https://sudokuoku.example';
  /** @type {Awaited<ReturnType<typeof createFakes>>} */
  let fakes;
  /** @type {Awaited<ReturnType<typeof start>>} */
  let api;
  /** @type {string} */
  let dataDir;
  /** @type {string[]} */
  const logs = [];

  before(async () => {
    fakes = await createFakes();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudokuoku-api-'));
    api = await start({ env: envFor(APP_URL), dataDir, port: 0, fetch: fakes.fetch, log: (level, message) => logs.push(`${level}: ${message}`) });
  });
  after(async () => {
    await api?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /** A browser's cookie jar, sending what the proxy in front of the API would pass on. */
  const browser = () => {
    /** @type {Map<string, string>} */
    const jar = new Map();
    /**
     * @param {string} method
     * @param {string} target a path below APP_URL, or an address on its origin
     * @param {{ json?: unknown }} [options]
     */
    const send = async (method, target, options = {}) => {
      const url = new URL(target, APP_URL);
      const headers = new Headers();
      if (jar.size) headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
      if (method !== 'GET') headers.set('origin', ORIGIN);
      if (options.json !== undefined) headers.set('content-type', 'application/json');
      const response = await realFetch(new URL(`${url.pathname}${url.search}`, api.url), {
        method,
        headers,
        body: options.json === undefined ? undefined : JSON.stringify(options.json),
        redirect: 'manual',
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ''] = cookie.split(';');
        const name = pair.slice(0, pair.indexOf('='));
        if (/;\s*Max-Age=0(?:;|$)/i.test(cookie)) jar.delete(name);
        else jar.set(name, pair.slice(pair.indexOf('=') + 1));
      }
      return response;
    };
    /** Signs in through the kit and the fake Google, returning to `back`. */
    const signIn = async (person = { sub: '1001', email: 'ada@example.com' }, back = '/') => {
      const started = await send('GET', `api/auth/google/start?return=${encodeURIComponent(back)}`);
      assert.equal(started.status, 302);
      const callback = fakes.consent(started.headers.get('location') ?? '', person);
      const landed = await send('GET', callback.href);
      assert.equal(landed.status, 302);
      return landed.headers.get('location');
    };
    const me = async () => /** @type {{ user: { email?: string } | null, entitlements: string[] }} */ (await (await send('GET', 'api/me')).json());
    return { jar, send, signIn, me };
  };

  /** @param {{ body: string, signature: string }} delivery */
  const deliver = (delivery) =>
    realFetch(new URL('api/webhooks/stripe', api.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': delivery.signature },
      body: delivery.body,
    });

  it('lists "Support this app" with its price from Stripe', async () => {
    const response = await browser().send('GET', 'api/config');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      auth: { google: true },
      shop: { products: [{ id: 'supporter', name: 'Support this app', description: catalogue.products[0]?.description, mode: 'payment', price: AMOUNT }] },
    });
    assert.deepEqual(api.features, { signIn: true, shop: true });
  });

  it('signs in, sells the support payment, grants it on the signed webhook alone, signs out and deletes the account', async () => {
    const visitor = browser();
    assert.deepEqual(await visitor.me(), { user: null, entitlements: [] });
    assert.equal((await visitor.send('POST', 'api/checkout', { json: { product: 'supporter' } })).status, 401, 'signed out, nothing is sold');
    // Back to the page the sign-in started from, its query too; never the fragment, which the
    // page keeps to itself (a challenge code lives there).
    assert.equal(await visitor.signIn(undefined, '/?/c/abc'), `${ORIGIN}/?/c/abc`);
    assert.deepEqual(await visitor.me(), { user: { email: 'ada@example.com' }, entitlements: [] });

    const checkout = await visitor.send('POST', 'api/checkout', { json: { product: 'supporter' } });
    assert.equal(checkout.status, 200);
    const { url } = /** @type {{ url: string }} */ (await checkout.json());
    assert.match(url, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_sudokuoku\d+$/);
    const asked = fakes.sessions.get(new URL(url).pathname.split('/').pop() ?? '');
    assert.ok(asked);
    assert.equal(asked.get('mode'), 'payment');
    assert.equal(asked.get('line_items[0][price]'), PRICE);
    assert.equal(asked.get('metadata[app]'), 'sudokuoku');
    assert.equal(asked.get('metadata[product]'), 'supporter');
    assert.equal(asked.get('metadata[user]'), 'google:1001');
    assert.equal(asked.get('success_url'), `${APP_URL}?purchase=success`);
    assert.equal(asked.get('cancel_url'), `${APP_URL}?purchase=cancelled`);

    // Coming back from Checkout grants nothing: only Stripe's signed word does, and a word
    // signed with another secret is refused.
    assert.deepEqual((await visitor.me()).entitlements, []);
    assert.equal((await deliver(signedDelivery(fakes.paid(url), { secret: 'whsec_notThisEndpointsSecret00' }))).status, 400);
    assert.deepEqual((await visitor.me()).entitlements, [], 'a webhook signed with another secret grants nothing');
    assert.equal((await deliver(signedDelivery(fakes.paid(url)))).status, 200);
    assert.deepEqual(await visitor.me(), { user: { email: 'ada@example.com' }, entitlements: ['supporter'] });
    assert.equal((await visitor.send('POST', 'api/checkout', { json: { product: 'supporter' } })).status, 409, 'a supporter is not sold it twice');

    assert.equal((await visitor.send('POST', 'api/auth/logout')).status, 204);
    assert.deepEqual(await visitor.me(), { user: null, entitlements: [] });
    await visitor.signIn();
    assert.deepEqual((await visitor.me()).entitlements, ['supporter'], 'the support is the account’s, not the browser’s');
    assert.equal((await visitor.send('DELETE', 'api/me')).status, 204);
    assert.deepEqual(await visitor.me(), { user: null, entitlements: [] });
    await visitor.signIn();
    assert.deepEqual(await visitor.me(), { user: { email: 'ada@example.com' }, entitlements: [] }, 'deleting the account took the support with it');

    assert.deepEqual(fakes.unexpected, []);
    assert.deepEqual(logs, []);
    // The file store holds the records, one file per key, named by the key's hash.
    assert.ok(fs.readdirSync(dataDir).length > 0);
    assert.ok(fs.readdirSync(dataDir).every((name) => /^[0-9a-f]{64}\.json$/.test(name)));
  });

  it('refuses a write from another origin, and one with no Origin at all', async () => {
    const visitor = browser();
    await visitor.signIn({ sub: '2002', email: 'grace@example.com' });
    const cookie = [...visitor.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    for (const origin of ['https://evil.example', null]) {
      const response = await realFetch(new URL('api/checkout', api.url), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify({ product: 'supporter' }),
      });
      assert.equal(response.status, 403, String(origin));
    }
  });
});

describe('what Delete account leaves, and what a refund takes back, as the README says', () => {
  // README, "Sign-in and Support this app": "A full refund or a dispute takes it back; a partial
  // refund leaves it", and Delete account "removes all of it but a count of the hour's Buy presses,
  // which names the account id and expires within two hours", with "a payment whose webhook arrives
  // after the deletion ... recorded under the account when it does". Each is the kit's behaviour,
  // read back here from Cloudflare's KV (the reference host), so the sentence and the kit cannot
  // part without this failing.
  const APP_URL = 'https://sudokuoku.example/';
  /** @type {Awaited<ReturnType<typeof createFakes>>} */
  let fakes;
  before(async () => {
    fakes = await createFakes();
  });

  /**
   * The app over a KV namespace of its own, which keeps what each key was last written with and
   * its expirationTtl.
   */
  const site = () => {
    /** @type {Map<string, string>} */
    const data = new Map();
    /** @type {Map<string, number>} */
    const ttl = new Map();
    const namespace = {
      get: async (/** @type {string} */ key) => (data.has(key) ? JSON.parse(data.get(key) ?? 'null') : null),
      put: async (/** @type {string} */ key, /** @type {string} */ value, /** @type {{ expirationTtl?: number } | undefined} */ options) => {
        data.set(key, value);
        if (options?.expirationTtl === undefined) ttl.delete(key);
        else ttl.set(key, options.expirationTtl);
      },
      delete: async (/** @type {string} */ key) => {
        data.delete(key);
        ttl.delete(key);
      },
    };
    const app = createApp({ catalogue, env: envFor(APP_URL), store: kvStore(() => namespace), fetch: fakes.fetch });
    return { app, data, ttl };
  };

  /** A browser's cookie jar, against the app as Cloudflare Pages runs it. */
  const visitor = (/** @type {ReturnType<typeof createApp>} */ app) => {
    /** @type {Map<string, string>} */
    const jar = new Map();
    /** @param {string} method @param {string} target @param {unknown} [json] */
    const send = async (method, target, json) => {
      const headers = new Headers();
      if (jar.size) headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
      if (method !== 'GET') headers.set('origin', 'https://sudokuoku.example');
      if (json !== undefined) headers.set('content-type', 'application/json');
      const response = await app.handle(new Request(new URL(target, APP_URL), { method, headers, body: json === undefined ? undefined : JSON.stringify(json), redirect: 'manual' }));
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ''] = cookie.split(';');
        const name = pair.slice(0, pair.indexOf('='));
        if (/;\s*Max-Age=0(?:;|$)/i.test(cookie)) jar.delete(name);
        else jar.set(name, pair.slice(pair.indexOf('=') + 1));
      }
      return response;
    };
    /** @param {{ sub: string, email: string }} person */
    const signIn = async (person) => {
      const started = await send('GET', 'api/auth/google/start?return=%2F');
      assert.equal((await send('GET', fakes.consent(started.headers.get('location') ?? '', person).href)).status, 302);
    };
    const held = async () => /** @type {{ entitlements: string[] }} */ (await (await send('GET', 'api/me')).json()).entitlements;
    /** Buy, and the checkout.session.completed Stripe would sign once it is paid (not yet sent). */
    const buy = async () => {
      const { url } = /** @type {{ url: string }} */ (await (await send('POST', 'api/checkout', { product: 'supporter' })).json());
      return fakes.paid(url);
    };
    return { send, signIn, held, buy };
  };
  /** @param {ReturnType<typeof createApp>} app @param {Record<string, unknown>} event */
  const deliver = async (app, event) => {
    const { body, signature } = signedDelivery(event);
    const answer = await app.handle(new Request(new URL('api/webhooks/stripe', APP_URL), { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body }));
    assert.equal(answer.status, 200, await answer.text());
  };
  /** The PaymentIntent a paid checkout.session.completed names. */
  const intentOf = (/** @type {Record<string, any>} */ paid) => String(paid.data.object.payment_intent);
  /** Stripe's charge.refunded for the payment `paid` made, `refunded` of its 300. */
  const refund = (/** @type {Record<string, unknown>} */ paid, /** @type {number} */ refunded) => ({
    id: `evt_refund${refunded}${intentOf(paid).replace(/[^0-9A-Za-z]/g, '')}`,
    object: 'event',
    type: 'charge.refunded',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: `ch_${refunded}`, object: 'charge', payment_intent: intentOf(paid), amount: 300, amount_refunded: refunded, refunded: refunded >= 300 } },
  });

  it('a partial refund leaves the support; a full one takes it back', async () => {
    const { app } = site();
    const ada = visitor(app);
    await ada.signIn({ sub: '3001', email: 'ada@example.com' });
    const paid = await ada.buy();
    await deliver(app, paid);
    assert.deepEqual(await ada.held(), ['supporter']);
    await deliver(app, refund(paid, 100));
    assert.deepEqual(await ada.held(), ['supporter'], 'a partial refund');
    await deliver(app, refund(paid, 300));
    assert.deepEqual(await ada.held(), [], 'the whole amount refunded');
  });

  it('Delete account leaves only the hour’s count of Buy presses naming the account, for two hours at most', async () => {
    const { app, data, ttl } = site();
    const grace = visitor(app);
    await grace.signIn({ sub: '3002', email: 'grace@example.com' });
    const paid = await grace.buy();
    await deliver(app, paid);
    assert.deepEqual(await grace.held(), ['supporter']);
    const intent = intentOf(paid);
    const naming = () => [...data.keys()].filter((key) => /3002|grace@example\.com|cus_sudokuoku1/.test(`${key} ${data.get(key)}`) || `${key} ${data.get(key)}`.includes(intent));
    assert.ok(naming().length >= 4, `the session, the user, the payment and the count: ${naming().join(' | ')}`);
    assert.equal((await grace.send('DELETE', 'api/me')).status, 204);
    assert.deepEqual(
      naming().map((key) => key.replace(/:\d+$/, ':<hour>')),
      ['sudokuoku:test:ratelimit:google:3002:<hour>'],
    );
    const left = naming()[0] ?? '';
    assert.ok((ttl.get(left) ?? Infinity) <= 2 * 60 * 60, `${left} expires within two hours`);
  });

  it('a payment whose webhook arrives after the deletion is recorded under the account', async () => {
    const { app } = site();
    const lin = visitor(app);
    await lin.signIn({ sub: '3003', email: 'lin@example.com' });
    const paid = await lin.buy();
    assert.equal((await lin.send('DELETE', 'api/me')).status, 204);
    await deliver(app, paid);
    await lin.signIn({ sub: '3003', email: 'lin@example.com' });
    assert.deepEqual(await lin.held(), ['supporter']);
  });

  it('and the README says so', () => {
    const readme = read('README.md').replace(/\s+/g, ' ');
    assert.match(readme, /A full refund or a dispute takes it back; a partial refund leaves it\./);
    assert.match(readme, /Delete account removes all of it but a count of the hour's Buy presses, which names the account id and expires within two hours/);
    assert.match(readme, /a payment whose webhook arrives after the deletion is recorded under the account when it does/);
    assert.doesNotMatch(readme, /removes all of it;/);
  });
});

describe('server/start.mjs run as a program', () => {
  const script = path.join(here, 'start.mjs');
  /**
   * The environment a service manager starts it with: none of the developer's.
   * @param {Record<string, string>} extra
   * @returns {NodeJS.ProcessEnv}
   */
  const bare = (extra) => ({ PATH: process.env.PATH ?? '', NODE_ENV: /** @type {const} */ ('production'), ...extra });

  it('refuses to start without a data directory', () => {
    const run = spawnSync(process.execPath, [script], { env: bare({}), encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /set KIT_DATA_DIR/);
  });

  it('listens on loopback, with everything off while nothing is configured, and warns of nothing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudokuoku-start-'));
    const child = spawn(process.execPath, [script], { env: bare({ KIT_DATA_DIR: dir, KIT_PORT: '0' }), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    try {
      const line = await new Promise((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (chunk) => {
          out += String(chunk);
          if (out.includes('\n')) resolve(out.trim());
        });
        child.on('exit', (code) => reject(new Error(`exited ${code}: ${stderr}`)));
      });
      const match = /^sudokuoku api listening on (http:\/\/127\.0\.0\.1:\d+\/) \(sign-in off, shop off\)$/.exec(String(line));
      assert.ok(match, String(line));
      const config = await realFetch(new URL('api/config', match[1]));
      assert.deepEqual(await config.json(), { auth: { google: false }, shop: { products: [] } });
      assert.equal((await realFetch(new URL('api/me', match[1]))).status, 404);
      // No warning: server/package.json says these files are ES modules, and no variable is
      // half set.
      assert.equal(stderr, '');
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
