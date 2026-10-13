/**
 * Sign in with Google and "Support this app", on the website: what the page reads from its own
 * site's api/ (server/kit, on the same origin), checked before anything is drawn from it; the
 * words the page says; and the decisions the Settings sheet draws from. Pure: no React Native,
 * no network, no address, so vitest loads it bare and the app config test's network scan reads
 * it like any other module.
 *
 * The network lives in `accountClient.web.ts`, which Metro bundles into the web build alone. Its
 * native twin, `accountClient.ts`, reports "not configured" and opens nothing: the iOS and
 * Android apps keep their no-network posture (INTERNET stays blocked). `account.tsx` puts
 * whichever of the two the platform resolves in front of the screens.
 *
 * Everything the server says is untrusted here, the way a stored save is (src/utils/saved.ts):
 * it is read field by field, and what does not hold up is left out rather than drawn, as text,
 * never as markup. What a purchase changes is one line of thanks in About and nothing in the
 * game: a visitor who edits the page can show themselves that line without paying, which the
 * README says plainly. The server's record of the payment is what a purchase is.
 */
import { PRIVACY, PRIVACY_WEB, PRIVACY_WITH_ACCOUNT, SUPPORTER_THANKS } from './about';

/** The one product the website sells, as server/catalogue.js names it. */
export const SUPPORTER_PRODUCT = 'supporter';
/** The entitlement a paid "Support this app" grants, as `GET api/me` reports it. */
export const SUPPORTER_ENTITLEMENT = 'supporter';

/** An id as the kit writes one: a product, an entitlement. */
const ID = /^[a-z][a-z0-9-]{0,31}$/;

/** A price as Stripe states it: in the currency's smallest unit. */
export interface Price {
  unitAmount: number;
  /** ISO 4217, lower case, as Stripe writes it. */
  currency: string;
}

export interface ShopProduct {
  id: string;
  name: string;
  description: string;
  /** Null when the server could not read it from Stripe: the product is still sold. */
  price: Price | null;
}

/** What `GET api/config` says is on. Null, wherever it is read, means the feature does not exist. */
export interface ApiConfig {
  /** Sign in with Google: true whenever this exists, since the kit sells nothing without it. */
  signIn: true;
  /** "Support this app" when the shop sells it; null when the shop is off. */
  supporter: ShopProduct | null;
}

export interface Account {
  /** Null when Google did not say the address is verified. */
  email: string | null;
}

/** What `GET api/me` says: who is signed in, and what they hold. */
export interface Me {
  user: Account | null;
  entitlements: readonly string[];
}

export const SIGNED_OUT: Me = { user: null, entitlements: [] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text of at most `max` characters with no control character: what a label may hold. */
function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

function readPrice(raw: unknown): Price | null {
  if (!isRecord(raw)) return null;
  const amount = raw.unit_amount;
  const currency = raw.currency;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null;
  if (typeof currency !== 'string' || !/^[a-z]{3}$/.test(currency)) return null;
  return { unitAmount: amount, currency };
}

/**
 * `GET api/config`'s body, or null when the feature does not exist: anything that is not the
 * kit's shape, and a body that says sign-in is off (the kit sells nothing without it, and a Buy
 * that can never sign in is a button that does nothing). "Support this app" is read from the
 * product list when it is there as this app sells it (once, `payment`); any other product is not
 * this build's to draw.
 */
export function readApiConfig(raw: unknown): ApiConfig | null {
  if (!isRecord(raw) || !isRecord(raw.auth) || raw.auth.google !== true) return null;
  const listed = isRecord(raw.shop) && Array.isArray(raw.shop.products) ? raw.shop.products : [];
  for (const item of listed) {
    if (!isRecord(item) || item.id !== SUPPORTER_PRODUCT || item.mode !== 'payment') continue;
    const name = text(item.name, 100);
    const description = text(item.description, 500);
    if (!name || description === null) continue;
    return { signIn: true, supporter: { id: SUPPORTER_PRODUCT, name, description, price: readPrice(item.price) } };
  }
  return { signIn: true, supporter: null };
}

/** `GET api/me`'s body, or null when it is not the kit's shape. */
export function readMe(raw: unknown): Me | null {
  if (!isRecord(raw) || !Array.isArray(raw.entitlements)) return null;
  let user: Account | null = null;
  if (raw.user !== null) {
    if (!isRecord(raw.user)) return null;
    user = { email: text(raw.user.email, 320) || null };
  }
  const entitlements = [...new Set(raw.entitlements.filter((e): e is string => typeof e === 'string' && ID.test(e)))].slice(0, 50);
  return { user, entitlements };
}

/** Stripe's zero-decimal currencies: an amount of 499 JPY is ¥499. */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
/** Stripe's three-decimal currencies: an amount of 1500 KWD is 1.500 KWD. */
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

/**
 * A price for people to read, in the visitor's locale (`undefined`, the browser's own). Null when
 * the platform cannot format the currency, and then the product is shown without one.
 */
export function formatPrice(price: Price, locale?: string): string | null {
  const divisor = ZERO_DECIMAL.has(price.currency) ? 1 : THREE_DECIMAL.has(price.currency) ? 1000 : 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency.toUpperCase() }).format(price.unitAmount / divisor);
  } catch {
    return null;
  }
}

/** What the address said on arrival: the kit's `?signin=failed`, and Checkout's way back. */
export interface Landing {
  signIn: 'failed' | null;
  purchase: 'success' | 'cancelled' | null;
}

export const NO_LANDING: Landing = { signIn: null, purchase: null };

/**
 * What an address says on arrival, and the same address without it (null when there was nothing
 * of ours to take out). Only the exact pairs the kit writes are read and removed (`signin=failed`,
 * `purchase=success`, `purchase=cancelled`), by hand rather than through URLSearchParams, which
 * would re-encode the rest of the query on the way back (`?/c/<code>` would return as
 * `?%2Fc%2F<code>=`). Everything else is kept as it was: other parameters, the older `?/c/<code>`
 * challenge links, and the fragment, where the website keeps a challenge link (src/app/links.ts).
 */
export function landingOf(href: string): { landing: Landing; without: string | null } {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { landing: NO_LANDING, without: null };
  }
  const pairs = url.search.slice(1).split('&');
  const ours = (pair: string) => pair === 'signin=failed' || pair === 'purchase=success' || pair === 'purchase=cancelled';
  const landing: Landing = {
    signIn: pairs.includes('signin=failed') ? 'failed' : null,
    purchase: pairs.includes('purchase=success') ? 'success' : pairs.includes('purchase=cancelled') ? 'cancelled' : null,
  };
  if (!landing.signIn && !landing.purchase) return { landing, without: null };
  const kept = pairs.filter((pair) => pair !== '' && !ours(pair));
  return { landing, without: `${url.pathname}${kept.length > 0 ? `?${kept.join('&')}` : ''}${url.hash}` };
}

/** How often, and how many times, `api/me` is asked after Checkout sends the visitor back. */
export const POLL = { tries: 5, everyMs: 3000 } as const;

/**
 * Asks `readMe` up to POLL.tries times, POLL.everyMs apart, until it reports `entitlement`: a
 * purchase is granted by Stripe's webhook, which may land after the visitor is back. Returns the
 * last answer and whether it held the entitlement.
 */
export async function pollFor(
  entitlement: string,
  readMe: () => Promise<Me | null>,
  wait: (ms: number) => Promise<void>,
): Promise<{ held: boolean; me: Me | null }> {
  let me: Me | null = null;
  for (let i = 0; i < POLL.tries; i += 1) {
    await wait(POLL.everyMs);
    me = await readMe();
    if (me?.entitlements.includes(entitlement)) return { held: true, me };
  }
  return { held: false, me };
}

/** How `POST api/checkout` ended, as the page reads it. */
export type CheckoutResult = 'redirecting' | 'signin' | 'owned' | 'unavailable' | 'busy' | 'failed';

/**
 * The website's account and shop, as a platform provides them. The web build's talks to the
 * site's api/; the native twin answers "not configured" to everything and opens nothing.
 */
export interface AccountClient {
  /** Whether this build asks api/ anything at all: false in the native twin. */
  readonly web: boolean;
  /** `GET api/config`; null for a 404, a network error, a body that is not JSON or nothing on. */
  config(): Promise<ApiConfig | null>;
  /** `GET api/me`; null when it cannot be read. */
  me(): Promise<Me | null>;
  /** A top-level navigation to `api/auth/google/start`, returning to this page. */
  signIn(): void;
  /** `POST api/auth/logout`: whether the server ended the session. */
  signOut(): Promise<boolean>;
  /** `DELETE api/me`: whether the server deleted the account. */
  deleteAccount(): Promise<boolean>;
  /** `POST api/checkout`, and on success a navigation to Stripe's Checkout. */
  checkout(product: string): Promise<CheckoutResult>;
  /** What the address said on arrival, read once and taken out of it. */
  takeLanding(): Landing;
}

/** The words the account and the shop say, the same in every app that carries the kit. */
export const WORDS = {
  section: 'Account',
  signIn: 'Sign in with Google',
  signedInAs: (email: string) => `Signed in as ${email}`,
  signedIn: 'Signed in with Google',
  signOut: 'Sign out',
  deleteAccount: 'Delete account',
  signInFailed: "Sign-in didn't complete.",
  buy: 'Buy',
  signInToBuy: 'Sign in to buy',
  owned: 'Owned',
  thanks: (name: string) => `Thank you — ${name} is unlocked.`,
  paymentPending: 'Payment received. It can take a minute to appear — reload to check.',
  dismiss: 'Dismiss',
} as const;

/** What the page asks before it deletes an account, and what it says when something fails. */
export const ACCOUNT_NOTES = {
  deleteTitle: 'Delete account?',
  deleteBody:
    'This deletes your account on this site, and your support with it: the thank-you in About goes too. The payment itself stays with Stripe, and your games stay in this browser. This cannot be undone.',
  deleteConfirm: 'Delete account',
  deleteCancel: 'Cancel',
  deleteFailed: 'The account could not be deleted. Try again.',
  signOutFailed: 'Could not sign out. Try again.',
  unavailable: 'Support is not on sale right now.',
  busy: 'Too many tries for now. Try again in a while.',
  failed: 'The shop could not be reached. Try again.',
} as const;

/** What the page knows of the account. `on` is false on a phone, and on a site with no api/. */
export interface AccountState {
  on: boolean;
  supporter: ShopProduct | null;
  me: Me;
  /** One line for the game screen: sign-in failed, a payment arrived, or one still on its way. */
  notice: string | null;
}

export const OFF_STATE: AccountState = { on: false, supporter: null, me: SIGNED_OUT, notice: null };

export const holdsSupport = (me: Me): boolean => me.entitlements.includes(SUPPORTER_ENTITLEMENT);

/**
 * The account as the page starts. A phone (the native twin) asks nothing. The web asks
 * `api/config` once: anything but a sign-in that is on (a 404 on GitHub Pages, a network error, a
 * body that is not the kit's) leaves the state off for good, with nothing stored, nothing retried
 * and the address untouched. Otherwise it reads and cleans the address (`?signin=failed`,
 * `?purchase=…`), asks `api/me`, and reports the state; back from a payment whose webhook has not
 * landed yet it asks `api/me` again (pollFor) and says how that ended. `update` receives each
 * change; `alive` says whether anything still listens.
 */
export async function loadAccount(
  client: AccountClient,
  { wait, alive, update }: { wait: (ms: number) => Promise<void>; alive: () => boolean; update: (change: (state: AccountState) => AccountState) => void },
): Promise<void> {
  if (!client.web) return;
  const config = await client.config();
  if (!alive() || !config) return;
  const landing = client.takeLanding();
  const me = (await client.me()) ?? SIGNED_OUT;
  if (!alive()) return;
  const product = config.supporter;
  const bought = landing.purchase === 'success' && product !== null;
  const thanks = product ? WORDS.thanks(product.name) : null;
  const notice = landing.signIn === 'failed' ? WORDS.signInFailed : bought && holdsSupport(me) ? thanks : null;
  update(() => ({ on: true, supporter: product, me, notice }));
  if (!bought || holdsSupport(me)) return;
  const { held, me: last } = await pollFor(SUPPORTER_ENTITLEMENT, () => client.me(), wait);
  if (!alive()) return;
  update((state) => ({ ...state, me: last ?? state.me, notice: held ? thanks : WORDS.paymentPending }));
}

/** What a Buy that did not leave for Checkout says, or null when there is nothing to say. */
export function checkoutNote(result: CheckoutResult): string | null {
  if (result === 'redirecting' || result === 'signin' || result === 'owned') return null;
  return ACCOUNT_NOTES[result];
}

/** Sign out, Delete account and Buy; each says what to tell the visitor when it did not work, or null. */
export interface AccountActions {
  signOut: () => Promise<string | null>;
  deleteAccount: () => Promise<string | null>;
  buySupport: () => Promise<string | null>;
}

/**
 * The three account actions, on `client`, with `refresh` asking `api/me` again and drawing what it
 * says. A sign-out or a deletion the server carried out is followed by a refresh. So is a Buy the
 * server answered 401 (the session ended meanwhile: signed out in another tab, or expired) or 409
 * (the support was bought meanwhile, in another tab): checkoutNote says nothing for either, so the
 * card drawn again from `api/me` (Sign in to buy, or Owned) is the only answer that press gets.
 * Each resolves once its refresh has.
 */
export function accountActions(client: AccountClient, refresh: () => Promise<void>): AccountActions {
  return {
    async signOut() {
      if (!(await client.signOut())) return ACCOUNT_NOTES.signOutFailed;
      await refresh();
      return null;
    },
    async deleteAccount() {
      if (!(await client.deleteAccount())) return ACCOUNT_NOTES.deleteFailed;
      await refresh();
      return null;
    },
    async buySupport() {
      const result = await client.checkout(SUPPORTER_PRODUCT);
      if (result === 'signin' || result === 'owned') await refresh();
      return checkoutNote(result);
    },
  };
}

/**
 * Runs the account actions one at a time, for the Settings sheet: `busy` is told when one starts
 * and when it has ended (the sheet disables the other buttons meanwhile), `say(null)` clears the
 * last note, and `say` then gets what the action said. A press that arrives while one is running
 * is refused, and the call returns false: the flag is set as the action starts, where a check of
 * the rendered `busy` reads false for every press until React has drawn again.
 */
export function oneAtATime(busy: (on: boolean) => void): (action: () => Promise<string | null>, say: (note: string | null) => void) => boolean {
  let running = false;
  return (action, say) => {
    if (running) return false;
    running = true;
    busy(true);
    say(null);
    void action()
      .then(say)
      .finally(() => {
        running = false;
        busy(false);
      });
    return true;
  };
}

/** What the Settings sheet draws of the account, the shop and About's privacy line. */
export interface AccountView {
  /** The Account card, or null when the site offers no sign-in. */
  account: { signedIn: boolean; line: string | null } | null;
  /** The "Support this app" card, or null when the site does not sell it. */
  support: { name: string; description: string; price: string | null; action: 'buy' | 'signin' | 'owned' } | null;
  /** About's sentence on what leaves the device, for this build and this site. */
  privacy: string;
  /** About's thanks, for a visitor the server reports as a supporter. */
  thanks: string | null;
}

export function accountView(state: AccountState, web: boolean, locale?: string): AccountView {
  if (!web) return { account: null, support: null, privacy: PRIVACY, thanks: null };
  if (!state.on) return { account: null, support: null, privacy: PRIVACY_WEB, thanks: null };
  const user = state.me.user;
  const supported = holdsSupport(state.me);
  const product = state.supporter;
  return {
    account: { signedIn: user !== null, line: user ? (user.email ? WORDS.signedInAs(user.email) : WORDS.signedIn) : null },
    support: product
      ? {
          name: product.name,
          description: product.description,
          price: product.price ? formatPrice(product.price, locale) : null,
          action: supported ? 'owned' : user ? 'buy' : 'signin',
        }
      : null,
    privacy: PRIVACY_WITH_ACCOUNT,
    thanks: supported ? SUPPORTER_THANKS : null,
  };
}
