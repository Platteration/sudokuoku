/**
 * The website's account and "Support this app": the one module of the app that talks to a
 * network, and only to the site's own api/ (server/kit, on Cloudflare Pages or behind nginx).
 * Metro bundles it into the web build alone; the iOS and Android apps get accountClient.ts, which
 * opens nothing. The site's policy allows exactly this (`connect-src 'self'`): Google and Stripe
 * are reached by top-level navigations, never by a request from the page.
 *
 * Where no function runs (GitHub Pages, Netlify, a plain static host) `api/config` is a 404, and
 * the page asks for nothing more: no sign-in and no shop are drawn, nothing is stored, nothing is
 * retried.
 */
import { AccountClient, ApiConfig, CheckoutResult, Landing, Me, landingOf, readApiConfig, readMe } from './accountModel';

/** The one address the page leaves for to pay: Stripe's hosted Checkout. */
export const CHECKOUT_ORIGIN = 'https://checkout.stripe.com';

/**
 * Whether `value` is an address on Stripe's Checkout, the only place Buy may send the page. The
 * slash after the host is what decides it: whatever follows is a path on that host, while without
 * it `https://checkout.stripe.com.evil.example/` and `https://checkout.stripe.com@evil.example/`
 * would name another one.
 */
export function isCheckoutUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${CHECKOUT_ORIGIN}/`);
}

/**
 * An address under the site's api/, beside the page: resolved against the page's own address, so
 * a site under a sub-path (`/sudokuoku/`) asks its own api/, not the domain's. The game is only
 * ever the page at the site's root: a challenge link keeps its code in the fragment or the query
 * (`#/c/<code>`, `?/c/<code>`), which a relative address drops; an older `/c/<code>` path link
 * is answered by the host's 404 page, not by the game.
 */
export function apiUrl(route: string, page: string = window.location.href): string {
  return new URL(`api/${route}`, page).href;
}

/** The body of a successful answer as JSON, or undefined for anything else. */
async function json(response: Response): Promise<unknown> {
  if (!response.ok) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** A question that changes nothing; undefined when it could not be asked or answered. */
async function get(route: string): Promise<unknown> {
  try {
    return await json(await fetch(apiUrl(route), { headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' }));
  } catch {
    return undefined;
  }
}

/** A request that changes something: same-origin, so the browser sends the Origin the kit checks. */
async function send(method: 'POST' | 'DELETE', route: string, body?: unknown): Promise<Response | null> {
  try {
    return await fetch(apiUrl(route), {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

export const accountClient: AccountClient = {
  web: true,

  async config(): Promise<ApiConfig | null> {
    return readApiConfig(await get('config'));
  },

  async me(): Promise<Me | null> {
    return readMe(await get('me'));
  },

  signIn(): void {
    // Back to this page and its query, never its fragment: the fragment is where a challenge
    // link keeps its code, and the page keeps that from every server (Referrer-Policy:
    // no-referrer), this one included.
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.assign(apiUrl(`auth/google/start?return=${encodeURIComponent(here)}`));
  },

  async signOut(): Promise<boolean> {
    return (await send('POST', 'auth/logout'))?.status === 204;
  },

  async deleteAccount(): Promise<boolean> {
    return (await send('DELETE', 'me'))?.status === 204;
  },

  async checkout(product: string): Promise<CheckoutResult> {
    const response = await send('POST', 'checkout', { product });
    if (!response) return 'failed';
    if (response.status === 401) return 'signin';
    if (response.status === 409) return 'owned';
    if (response.status === 404) return 'unavailable';
    if (response.status === 429) return 'busy';
    const body = await json(response);
    const url = typeof body === 'object' && body !== null && 'url' in body ? body.url : undefined;
    if (!isCheckoutUrl(url)) return 'failed';
    window.location.assign(url);
    return 'redirecting';
  },

  takeLanding(): Landing {
    const { landing, without } = landingOf(window.location.href);
    if (without === null) return landing;
    try {
      window.history.replaceState(window.history.state, '', without);
    } catch {
      // Safari refuses a rewrite past a hundred in ten seconds: the address keeps the pair, and
      // the notice is still said once, for this load.
    }
    return landing;
  },
};
