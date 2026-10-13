/**
 * The website's sign-in and "Support this app", without a renderer: what the page reads from its
 * site's api/ (server/kit), the decisions the provider and the Settings sheet draw from, and the
 * web client against a stand-in for the browser. The cards themselves are drawn in Chromium by
 * the browser suite (e2e/run.mjs), against the kit, under the site's policy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIVACY, PRIVACY_WEB, PRIVACY_WITH_ACCOUNT, SUPPORTER_THANKS } from '../about';
import { accountClient as webClient, apiUrl, isCheckoutUrl } from '../accountClient.web';
import {
  ACCOUNT_NOTES,
  AccountClient,
  AccountState,
  ApiConfig,
  Landing,
  Me,
  NO_LANDING,
  OFF_STATE,
  POLL,
  SIGNED_OUT,
  WORDS,
  accountView,
  checkoutNote,
  formatPrice,
  landingOf,
  loadAccount,
  pollFor,
  readApiConfig,
  readMe,
} from '../accountModel';

/** What the kit's `GET api/config` answers with the shop on (server/kit/app.js). */
const CONFIGURED = {
  auth: { google: true },
  shop: {
    products: [
      { id: 'supporter', name: 'Support this app', description: 'A one-time payment towards Sudokuoku.', mode: 'payment', price: { unit_amount: 300, currency: 'eur' } },
    ],
  },
};
const SUPPORTER: ApiConfig = {
  signIn: true,
  supporter: { id: 'supporter', name: 'Support this app', description: 'A one-time payment towards Sudokuoku.', price: { unitAmount: 300, currency: 'eur' } },
};

describe('api/config', () => {
  it('is no feature at all unless it says sign-in is on', () => {
    for (const body of [undefined, null, 'html', 42, [], {}, { auth: null }, { auth: { google: false }, shop: CONFIGURED.shop }, { auth: { google: 'true' } }, { auth: [] }]) {
      expect(readApiConfig(body), JSON.stringify(body)).toBeNull();
    }
  });

  it('is sign-in alone when nothing is sold', () => {
    expect(readApiConfig({ auth: { google: true }, shop: { products: [] } })).toEqual({ signIn: true, supporter: null });
    expect(readApiConfig({ auth: { google: true } })).toEqual({ signIn: true, supporter: null });
    expect(readApiConfig({ auth: { google: true }, shop: { products: 'all' } })).toEqual({ signIn: true, supporter: null });
  });

  it('reads "Support this app", its price in the smallest unit as Stripe states it', () => {
    expect(readApiConfig(CONFIGURED)).toEqual(SUPPORTER);
  });

  it('draws only the product this build sells, as it sells it, with words it can draw', () => {
    const product = CONFIGURED.shop.products[0]!; // the one product listed above
    const only = (item: unknown) => readApiConfig({ auth: { google: true }, shop: { products: [item] } })?.supporter ?? null;
    expect(only({ ...product, id: 'pro' })).toBeNull();
    expect(only({ ...product, mode: 'subscription' })).toBeNull();
    expect(only({ ...product, name: '' })).toBeNull();
    expect(only({ ...product, name: 'x'.repeat(101) })).toBeNull();
    expect(only({ ...product, name: 'Support\nthis app' })).toBeNull();
    expect(only({ ...product, name: { toString: () => 'Support' } })).toBeNull();
    expect(only({ ...product, description: 'x'.repeat(501) })).toBeNull();
    expect(only({ ...product, description: 'tab\there' })).toBeNull();
    expect(only({ ...product, description: '' })?.description).toBe('');
    expect(only('supporter')).toBeNull();
    // a later good listing still counts
    expect(readApiConfig({ auth: { google: true }, shop: { products: [{ ...product, mode: 'subscription' }, product] } })).toEqual(SUPPORTER);
  });

  it('lists a product whose price could not be read without one', () => {
    const product = CONFIGURED.shop.products[0]!; // the one product listed above
    const price = (value: unknown) => readApiConfig({ auth: { google: true }, shop: { products: [{ ...product, price: value }] } })?.supporter?.price;
    expect(price(undefined)).toBeNull();
    expect(price({ unit_amount: -1, currency: 'eur' })).toBeNull();
    expect(price({ unit_amount: 1.5, currency: 'eur' })).toBeNull();
    expect(price({ unit_amount: '300', currency: 'eur' })).toBeNull();
    expect(price({ unit_amount: 300, currency: 'EUR' })).toBeNull();
    expect(price({ unit_amount: 300, currency: 'euro' })).toBeNull();
    expect(price({ unit_amount: 0, currency: 'usd' })).toEqual({ unitAmount: 0, currency: 'usd' });
  });
});

describe('api/me', () => {
  it('reads who is signed in and what they hold', () => {
    expect(readMe({ user: null, entitlements: [] })).toEqual(SIGNED_OUT);
    expect(readMe({ user: { email: 'ada@example.com' }, entitlements: ['supporter'] })).toEqual({ user: { email: 'ada@example.com' }, entitlements: ['supporter'] });
    expect(readMe({ user: {}, entitlements: [] })).toEqual({ user: { email: null }, entitlements: [] });
    expect(readMe({ user: { email: 'a\nb@example.com' }, entitlements: [] })).toEqual({ user: { email: null }, entitlements: [] });
  });

  it('keeps only entitlements of the kit’s shape, once each', () => {
    expect(readMe({ user: null, entitlements: ['supporter', 'supporter', 'Supporter', 7, null, 'pro', '-x', 'a'.repeat(33)] })?.entitlements).toEqual(['supporter', 'pro']);
  });

  it('is unreadable when it is not the kit’s shape', () => {
    for (const body of [undefined, null, {}, { user: null }, { user: 'ada', entitlements: [] }, { user: [], entitlements: [] }, { user: null, entitlements: 'supporter' }]) {
      expect(readMe(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe('prices', () => {
  it('are divided as Stripe counts each currency, and formatted for the visitor', () => {
    expect(formatPrice({ unitAmount: 300, currency: 'eur' }, 'en-GB')).toBe('€3.00');
    expect(formatPrice({ unitAmount: 499, currency: 'usd' }, 'en-US')).toBe('$4.99');
    expect(formatPrice({ unitAmount: 499, currency: 'jpy' }, 'en-US')).toBe('¥499');
    expect(formatPrice({ unitAmount: 1500, currency: 'kwd' }, 'en-US')).toMatch(/^KWD\s1\.500$/); // a no-break space between
  });

  it('are left out when the currency cannot be formatted', () => {
    expect(formatPrice({ unitAmount: 300, currency: 'zzq' }, 'en-GB')).not.toBeNull(); // a well-formed code Intl does not know still formats
    expect(formatPrice({ unitAmount: 300, currency: '123' }, 'en-GB')).toBeNull();
  });
});

describe('the address on arrival', () => {
  const base = 'https://example.com/sudokuoku/';

  it('is nothing of ours without the pairs the kit writes', () => {
    for (const href of [base, `${base}?signin=ok`, `${base}?purchase=done`, `${base}?/c/abc`, `${base}#/c/abc`, `${base}?signin=fail%65d`, 'not a url']) {
      expect(landingOf(href), href).toEqual({ landing: NO_LANDING, without: null });
    }
  });

  it('says a sign-in failed, and leaves the address without saying so', () => {
    expect(landingOf(`${base}?signin=failed`)).toEqual({ landing: { signIn: 'failed', purchase: null }, without: '/sudokuoku/' });
  });

  it('says how Checkout ended', () => {
    expect(landingOf(`${base}?purchase=success`)).toEqual({ landing: { signIn: null, purchase: 'success' }, without: '/sudokuoku/' });
    expect(landingOf(`${base}?purchase=cancelled`)).toEqual({ landing: { signIn: null, purchase: 'cancelled' }, without: '/sudokuoku/' });
  });

  it('keeps everything else as it was: other pairs, a challenge link in the query or the fragment', () => {
    expect(landingOf(`${base}?/c/AbC_-1&purchase=success#/c/XyZ`)).toEqual({ landing: { signIn: null, purchase: 'success' }, without: '/sudokuoku/?/c/AbC_-1#/c/XyZ' });
    expect(landingOf(`${base}?a=1&signin=failed&b=%2F`).without).toBe('/sudokuoku/?a=1&b=%2F');
    expect(landingOf(`${base}?signin=failed#/c/abc`).without).toBe('/sudokuoku/#/c/abc');
  });
});

describe('after Checkout', () => {
  const me = (entitlements: string[]): Me => ({ user: { email: 'ada@example.com' }, entitlements });

  it('asks api/me again until the support shows, three seconds apart, five times at most', async () => {
    const waits: number[] = [];
    const answers = [me([]), null, me(['supporter'])];
    const asked = vi.fn(async () => answers.shift() ?? me([]));
    const result = await pollFor('supporter', asked, async (ms) => void waits.push(ms));
    expect(result).toEqual({ held: true, me: me(['supporter']) });
    expect(asked).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([3000, 3000, 3000]);
  });

  it('gives up after fifteen seconds with the last answer', async () => {
    const waits: number[] = [];
    const asked = vi.fn(async () => me([]));
    expect(await pollFor('supporter', asked, async (ms) => void waits.push(ms))).toEqual({ held: false, me: me([]) });
    expect(asked).toHaveBeenCalledTimes(POLL.tries);
    expect(POLL).toEqual({ tries: 5, everyMs: 3000 });
    expect(waits.reduce((a, b) => a + b, 0)).toBe(15000);
  });
});

/** A client that records what it was asked, answering `config` and `me` from the given lists. */
function fakeClient({ web = true, config = SUPPORTER as ApiConfig | null, me = [] as (Me | null)[], landing = NO_LANDING as Landing } = {}) {
  const calls: string[] = [];
  const client: AccountClient = {
    web,
    config: async () => {
      calls.push('config');
      return config;
    },
    me: async () => {
      calls.push('me');
      return me.length > 1 ? (me.shift() ?? null) : (me[0] ?? null);
    },
    signIn: () => void calls.push('signIn'),
    signOut: async () => (calls.push('signOut'), true),
    deleteAccount: async () => (calls.push('deleteAccount'), true),
    checkout: async () => (calls.push('checkout'), 'redirecting'),
    takeLanding: () => (calls.push('takeLanding'), landing),
  };
  return { client, calls };
}

/** Runs loadAccount to the end, folding every update into one state, as the provider does. */
async function load(client: AccountClient, alive = () => true) {
  let state: AccountState = OFF_STATE;
  const updates: AccountState[] = [];
  const waits: number[] = [];
  await loadAccount(client, {
    wait: async (ms) => void waits.push(ms),
    alive,
    update: (change) => {
      state = change(state);
      updates.push(state);
    },
  });
  return { state, updates, waits };
}

const ada = (entitlements: string[] = []): Me => ({ user: { email: 'ada@example.com' }, entitlements });

describe('the account as the page starts', () => {
  it('asks nothing in the iOS and Android apps', async () => {
    const { client, calls } = fakeClient({ web: false });
    const { updates } = await load(client);
    expect(calls).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('on a site with no api/ (a 404) is off for good: one question, nothing drawn, the address untouched', async () => {
    const { client, calls } = fakeClient({ config: null, landing: { signIn: 'failed', purchase: 'success' } });
    const { updates } = await load(client);
    expect(calls).toEqual(['config']);
    expect(updates).toEqual([]);
  });

  it('with sign-in on, reads the address once, asks who is signed in, and says nothing more', async () => {
    const { client, calls } = fakeClient({ me: [ada()] });
    const { state, updates } = await load(client);
    expect(calls).toEqual(['config', 'takeLanding', 'me']);
    expect(updates).toHaveLength(1);
    expect(state).toEqual({ on: true, supporter: SUPPORTER.supporter, me: ada(), notice: null });
  });

  it('treats an api/me it cannot read as signed out', async () => {
    const { client } = fakeClient({ me: [null] });
    expect((await load(client)).state.me).toEqual(SIGNED_OUT);
  });

  it('says once that a sign-in did not complete', async () => {
    const { client } = fakeClient({ me: [SIGNED_OUT], landing: { signIn: 'failed', purchase: null } });
    expect((await load(client)).state.notice).toBe("Sign-in didn't complete.");
  });

  it('back from a payment already granted, thanks the visitor without asking again', async () => {
    const { client, calls } = fakeClient({ me: [ada(['supporter'])], landing: { signIn: null, purchase: 'success' } });
    const { state, waits } = await load(client);
    expect(state.notice).toBe('Thank you — Support this app is unlocked.');
    expect(calls.filter((c) => c === 'me')).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('back from a payment whose webhook has not landed, asks until it does, then thanks', async () => {
    const { client, calls } = fakeClient({ me: [ada(), ada(), ada(['supporter'])], landing: { signIn: null, purchase: 'success' } });
    const { state, updates, waits } = await load(client);
    expect(updates.map((u) => u.notice)).toEqual([null, 'Thank you — Support this app is unlocked.']);
    expect(state.me).toEqual(ada(['supporter']));
    expect(calls.filter((c) => c === 'me')).toHaveLength(3);
    expect(waits).toEqual([3000, 3000]);
  });

  it('and when it has not landed in fifteen seconds, says it may take a minute', async () => {
    const { client } = fakeClient({ me: [ada()], landing: { signIn: null, purchase: 'success' } });
    const { state, waits } = await load(client);
    expect(state.notice).toBe('Payment received. It can take a minute to appear — reload to check.');
    expect(waits).toHaveLength(5);
  });

  it('says nothing after a cancelled Checkout, and asks nothing more', async () => {
    const { client, calls } = fakeClient({ me: [ada()], landing: { signIn: null, purchase: 'cancelled' } });
    const { state } = await load(client);
    expect(state.notice).toBeNull();
    expect(calls).toEqual(['config', 'takeLanding', 'me']);
  });

  it('does not thank anyone for a payment the site does not sell', async () => {
    const { client, calls } = fakeClient({ config: { signIn: true, supporter: null }, me: [ada()], landing: { signIn: null, purchase: 'success' } });
    const { state } = await load(client);
    expect(state.notice).toBeNull();
    expect(calls.filter((c) => c === 'me')).toHaveLength(1);
  });

  it('says nothing of the payment once nothing listens any more', async () => {
    // Left before the fifteen seconds were up: the answer that came in afterwards is not drawn.
    let listening = true;
    const { client } = fakeClient({ me: [ada(), ada(), ada(['supporter'])], landing: { signIn: null, purchase: 'success' } });
    let polled = 0;
    const original = client.me;
    client.me = async () => {
      polled += 1;
      if (polled > 1) listening = false;
      return original();
    };
    const { updates } = await load(client, () => listening);
    expect(updates.map((u) => u.notice)).toEqual([null]);
  });

  it('stops as soon as nothing listens any more', async () => {
    let listening = true;
    const { client } = fakeClient({ me: [ada()], landing: { signIn: null, purchase: 'success' } });
    const original = client.me;
    client.me = async () => {
      listening = false;
      return original();
    };
    const { updates } = await load(client, () => listening);
    expect(updates).toEqual([]);
  });
});

describe('what Settings draws', () => {
  const on = (me: Me, supporter = SUPPORTER.supporter): AccountState => ({ on: true, supporter, me, notice: null });

  it('in the iOS and Android apps: no account, no shop, and nothing leaves the device', () => {
    for (const state of [OFF_STATE, on(ada(['supporter']))]) {
      expect(accountView(state, false)).toEqual({ account: null, support: null, privacy: PRIVACY, thanks: null });
    }
  });

  it('on a site with no api/: no account, no shop, and what is true of the page', () => {
    expect(accountView(OFF_STATE, true)).toEqual({ account: null, support: null, privacy: PRIVACY_WEB, thanks: null });
  });

  it('signed out: Sign in with Google, and Sign in to buy', () => {
    expect(accountView(on(SIGNED_OUT), true, 'en-GB')).toEqual({
      account: { signedIn: false, line: null },
      support: { name: 'Support this app', description: 'A one-time payment towards Sudokuoku.', price: '€3.00', action: 'signin' },
      privacy: PRIVACY_WITH_ACCOUNT,
      thanks: null,
    });
  });

  it('signed in: who, and Buy', () => {
    const view = accountView(on(ada()), true, 'en-GB');
    expect(view.account).toEqual({ signedIn: true, line: 'Signed in as ada@example.com' });
    expect(view.support?.action).toBe('buy');
    expect(view.thanks).toBeNull();
    expect(accountView(on({ user: { email: null }, entitlements: [] }), true).account).toEqual({ signedIn: true, line: 'Signed in with Google' });
  });

  it('a supporter: Owned, and the thanks in About', () => {
    const view = accountView(on(ada(['supporter'])), true);
    expect(view.support?.action).toBe('owned');
    expect(view.thanks).toBe(SUPPORTER_THANKS);
    expect(SUPPORTER_THANKS).toBe('Thank you for supporting Sudokuoku.');
  });

  it('sign-in alone, when the site sells nothing; and a price it could not read is left out', () => {
    expect(accountView(on(ada(), null), true).support).toBeNull();
    const unpriced = { ...SUPPORTER.supporter!, price: null }; // SUPPORTER sells it
    expect(accountView(on(ada(), unpriced), true).support?.price).toBeNull();
  });

  it('says what a Buy that did not leave for Checkout means', () => {
    expect(checkoutNote('redirecting')).toBeNull();
    expect(checkoutNote('signin')).toBeNull();
    expect(checkoutNote('owned')).toBeNull();
    expect(checkoutNote('unavailable')).toBe('Support is not on sale right now.');
    expect(checkoutNote('busy')).toBe('Too many tries for now. Try again in a while.');
    expect(checkoutNote('failed')).toBe('The shop could not be reached. Try again.');
  });

  it('in the words every app that carries the kit uses', () => {
    expect([WORDS.section, WORDS.signIn, WORDS.signedInAs('a@b.c'), WORDS.signedIn, WORDS.signOut, WORDS.deleteAccount, WORDS.signInFailed]).toEqual([
      'Account',
      'Sign in with Google',
      'Signed in as a@b.c',
      'Signed in with Google',
      'Sign out',
      'Delete account',
      "Sign-in didn't complete.",
    ]);
    expect([WORDS.buy, WORDS.signInToBuy, WORDS.owned, WORDS.thanks('X'), WORDS.paymentPending]).toEqual([
      'Buy',
      'Sign in to buy',
      'Owned',
      'Thank you — X is unlocked.',
      'Payment received. It can take a minute to appear — reload to check.',
    ]);
    expect(ACCOUNT_NOTES.deleteTitle).toBe('Delete account?');
    expect(ACCOUNT_NOTES.deleteBody).toMatch(/your support with it.*The payment itself stays with Stripe/);
    expect(PRIVACY_WITH_ACCOUNT).toMatch(/^Nothing leaves your device unless you sign in or buy\. /);
  });
});

describe('the web client', () => {
  const PAGE = 'https://example.com/sudokuoku/?/c/AbC#/c/XyZ';
  let assigned: string[];
  let replaced: string[];
  let states: unknown[];
  let fetches: { url: string; init: RequestInit }[];
  let answer: (url: string, init: RequestInit) => Promise<Response>;

  beforeEach(() => {
    assigned = [];
    replaced = [];
    states = [];
    fetches = [];
    answer = async () => new Response('not found', { status: 404 });
    const url = new URL(PAGE);
    vi.stubGlobal('window', {
      location: {
        get href() {
          return url.href;
        },
        get pathname() {
          return url.pathname;
        },
        get search() {
          return url.search;
        },
        assign: (to: string) => void assigned.push(to),
      },
      history: {
        state: { kept: true },
        replaceState: (state: unknown, _title: string, to: string) => {
          states.push(state);
          replaced.push(to);
          const next = new URL(to, url.href);
          url.href = next.href;
        },
      },
    });
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      fetches.push({ url: input, init });
      return answer(input, init);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the site’s own api/, beside the page, whatever path the site is under', () => {
    expect(apiUrl('config')).toBe('https://example.com/sudokuoku/api/config');
    expect(apiUrl('me', 'https://example.com/')).toBe('https://example.com/api/me');
    expect(apiUrl('me', 'https://example.com/sudokuoku/index.html')).toBe('https://example.com/sudokuoku/api/me');
  });

  it('reads a 404, a network error and a body that is not JSON as no feature at all', async () => {
    expect(await webClient.config()).toBeNull();
    answer = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await webClient.config()).toBeNull();
    answer = async () => new Response('<!doctype html>', { status: 200 });
    expect(await webClient.config()).toBeNull();
    answer = async () => Response.json({ auth: { google: false }, shop: { products: [] } });
    expect(await webClient.config()).toBeNull();
    answer = async () => Response.json(CONFIGURED, { status: 500 });
    expect(await webClient.config(), 'only a successful answer counts').toBeNull();
    answer = async () => Response.json(CONFIGURED);
    expect(await webClient.config()).toEqual(SUPPORTER);
    expect(fetches.map((f) => f.url)).toEqual(Array(6).fill('https://example.com/sudokuoku/api/config'));
    for (const { init } of fetches) expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
  });

  it('asks who is signed in without a cached answer', async () => {
    answer = async () => Response.json({ user: { email: 'ada@example.com' }, entitlements: ['supporter'] });
    expect(await webClient.me()).toEqual(ada(['supporter']));
    expect(fetches[0]).toMatchObject({ url: 'https://example.com/sudokuoku/api/me', init: { cache: 'no-store', credentials: 'same-origin' } });
  });

  it('signs in by leaving for api/auth/google/start, coming back to this page and query, never its fragment', () => {
    webClient.signIn();
    expect(assigned).toEqual([`https://example.com/sudokuoku/api/auth/google/start?return=${encodeURIComponent('/sudokuoku/?/c/AbC')}`]);
    expect(assigned[0]).not.toContain('XyZ');
    expect(fetches).toEqual([]);
  });

  it('signs out and deletes with requests that change something, and says whether they did', async () => {
    answer = async () => new Response(null, { status: 204 });
    expect(await webClient.signOut()).toBe(true);
    expect(await webClient.deleteAccount()).toBe(true);
    expect(fetches.map((f) => `${f.init.method} ${f.url}`)).toEqual(['POST https://example.com/sudokuoku/api/auth/logout', 'DELETE https://example.com/sudokuoku/api/me']);
    for (const { init } of fetches) {
      expect(init.credentials).toBe('same-origin');
      expect(init.body).toBeUndefined();
    }
    for (const status of [200, 401, 403, 500]) {
      answer = async () => new Response(null, { status });
      expect(await webClient.signOut(), String(status)).toBe(false);
      expect(await webClient.deleteAccount(), String(status)).toBe(false);
    }
    answer = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await webClient.signOut()).toBe(false);
    expect(await webClient.deleteAccount()).toBe(false);
  });

  it('buys by asking api/checkout as JSON, and leaves only for Stripe’s Checkout', async () => {
    answer = async () => Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(await webClient.checkout('supporter')).toBe('redirecting');
    expect(fetches[0]?.url).toBe('https://example.com/sudokuoku/api/checkout');
    expect(fetches[0]?.init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"product":"supporter"}', headers: { 'content-type': 'application/json' } });
    expect(assigned).toEqual(['https://checkout.stripe.com/c/pay/cs_test_1']);
    for (const url of ['https://checkout.stripe.com.evil.example/c/pay', 'https://checkout.stripe.com@evil.example/', 'http://checkout.stripe.com/c/pay', 'https://checkout.stripe.com', 'javascript:alert(1)', 42, null]) {
      answer = async () => Response.json({ url });
      expect(await webClient.checkout('supporter'), String(url)).toBe('failed');
    }
    expect(assigned).toHaveLength(1);
  });

  it('says why a Buy did not leave', async () => {
    for (const [status, result] of [
      [401, 'signin'],
      [409, 'owned'],
      [404, 'unavailable'],
      [429, 'busy'],
      [502, 'failed'],
      [500, 'failed'],
    ] as const) {
      answer = async () => Response.json({ error: 'x' }, { status });
      expect(await webClient.checkout('supporter'), String(status)).toBe(result);
    }
    answer = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await webClient.checkout('supporter')).toBe('failed');
    expect(assigned).toEqual([]);
  });

  it('checks a Checkout address by its whole origin and the slash after it', () => {
    expect(isCheckoutUrl('https://checkout.stripe.com/')).toBe(true);
    expect(isCheckoutUrl('https://checkout.stripe.com/c/pay/cs_live_x#y')).toBe(true);
    expect(isCheckoutUrl('https://checkout.stripe.comx/')).toBe(false);
    expect(isCheckoutUrl('https://checkout.stripe.com')).toBe(false);
  });

  it('takes the kit’s pair out of the address once, keeping the rest and the history entry’s state', () => {
    const page = window.location;
    replaced.length = 0;
    window.history.replaceState(null, '', '/sudokuoku/?/c/AbC&purchase=success#/c/XyZ');
    replaced.length = 0;
    states.length = 0;
    expect(webClient.takeLanding()).toEqual({ signIn: null, purchase: 'success' });
    expect(replaced).toEqual(['/sudokuoku/?/c/AbC#/c/XyZ']);
    expect(states).toEqual([{ kept: true }]); // the history entry keeps what it held
    expect(page.href).toBe('https://example.com/sudokuoku/?/c/AbC#/c/XyZ');
    // read once: the second time there is nothing of ours left
    expect(webClient.takeLanding()).toEqual(NO_LANDING);
    expect(replaced).toHaveLength(1);
  });

  it('still says what the address said when the browser refuses to rewrite it', () => {
    window.history.replaceState(null, '', '/sudokuoku/?signin=failed');
    vi.stubGlobal('window', {
      location: window.location,
      history: {
        state: null,
        replaceState: () => {
          throw new Error('SecurityError: too many calls');
        },
      },
    });
    expect(webClient.takeLanding()).toEqual({ signIn: 'failed', purchase: null });
  });
});
