// @ts-check
// Test tooling only, never imported by the API itself (server/api.test.mjs holds that): a fake
// Google and a fake Stripe behind one `fetch`, which the tests hand to server/kit through
// `createApp({ fetch })` (serve()'s and createNodeHandler()'s `fetch`). Nothing points the kit
// at another host: it calls Google's and Stripe's real addresses, and this function answers them.
// Shared by server/api.test.mjs and the browser suite (e2e/run.mjs).
//
// Google: an RSA key made with Web Crypto, its JWKS, an authorization step (`consent`) that turns
// the authorize URL the kit sent the browser to into the callback URL Google would send it back
// to, and a token endpoint that checks the code, the client and the PKCE verifier before it signs
// an ID token for the nonce. Stripe: the "Support this app" Price, Checkout Sessions recorded as
// the kit created them, and webhook events signed as Stripe signs them (with node:crypto, not
// with the kit's own HMAC).

import { Buffer } from 'node:buffer';
import { createHash, createHmac } from 'node:crypto';

export const CLIENT_ID = 'sudokuoku-test.apps.googleusercontent.com';
export const CLIENT_SECRET = 'sudokuoku-test-google-secret';
/**
 * A Stripe test-mode key in shape only: Stripe has never issued it. It is put together here
 * rather than written out because GitHub's push protection matches the literal pattern of a
 * Stripe secret key and refuses a push that holds one, fake or not.
 */
export const STRIPE_KEY = ['sk', 'test', 'sudokuokuFakeKey00000000'].join('_');
export const WEBHOOK_SECRET = 'whsec_sudokuokuFakeSecret000000';
export const PRICE = 'price_sudokuokuSupporter';
/** What the fake Price costs: three euros, in cents as Stripe counts them. */
export const AMOUNT = { unit_amount: 300, currency: 'eur' };
/** 32 bytes, base64url. */
export const SESSION_SECRET = 'c3Vkb2t1b2t1LXNlc3Npb24tc2VjcmV0LWZvci10ZXN0cw';

/**
 * The variables a deployment sets, for an API whose public address is `appUrl`.
 * @param {string} appUrl
 * @returns {Record<string, string>}
 */
export function envFor(appUrl) {
  return {
    APP_URL: appUrl,
    SESSION_SECRET,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    STRIPE_SECRET_KEY: STRIPE_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_SUPPORTER: PRICE,
  };
}

const encoder = new globalThis.TextEncoder();
/** @param {string | ArrayBuffer} data */
const b64 = (data) => Buffer.from(typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data)).toString('base64url');

/** @typedef {{ sub: string, email: string }} Person */

/**
 * A fake Google and a fake Stripe. `fetch` is what the kit is given; the rest is for a test to
 * play the browser's part and Stripe's.
 */
export async function createFakes() {
  const { subtle } = globalThis.crypto;
  const keys = /** @type {CryptoKeyPair} */ (
    await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  );
  const jwk = { ...(await subtle.exportKey('jwk', keys.publicKey)), kid: 'sudokuoku-fake-key', alg: 'RS256', use: 'sig' };
  /** @type {Map<string, { challenge: string, redirectUri: string, nonce: string, person: Person }>} */
  const codes = new Map();
  /** @type {Map<string, URLSearchParams>} */
  const sessions = new Map();
  /** @type {string[]} */
  const unexpected = [];
  /** @type {string[]} */
  const calls = [];
  let seq = 0;

  /** @param {Record<string, unknown>} claims */
  const signIdToken = async (claims) => {
    const head = b64(JSON.stringify({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' }));
    const body = b64(JSON.stringify(claims));
    const signature = await subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, encoder.encode(`${head}.${body}`));
    return `${head}.${body}.${b64(signature)}`;
  };

  /**
   * Google's token endpoint: a code is exchanged once, by this client, with its secret, for the
   * redirect URI it was issued to, and with the verifier whose S256 is the challenge it was
   * issued for.
   * @param {string} body
   * @returns {Promise<Response>}
   */
  const token = async (body) => {
    const form = new URLSearchParams(body);
    const code = form.get('code') ?? '';
    const grant = codes.get(code);
    codes.delete(code);
    const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
    if (
      !grant ||
      form.get('grant_type') !== 'authorization_code' ||
      form.get('client_id') !== CLIENT_ID ||
      form.get('client_secret') !== CLIENT_SECRET ||
      form.get('redirect_uri') !== grant.redirectUri ||
      challenge !== grant.challenge
    ) {
      return globalThis.Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    const at = Math.floor(Date.now() / 1000);
    const idToken = await signIdToken({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      azp: CLIENT_ID,
      sub: grant.person.sub,
      email: grant.person.email,
      email_verified: true,
      iat: at,
      exp: at + 3600,
      nonce: grant.nonce,
    });
    return globalThis.Response.json({ id_token: idToken, access_token: 'unused', token_type: 'Bearer', expires_in: 3599 });
  };

  /**
   * @param {string} path below https://api.stripe.com/v1
   * @param {string} method
   * @param {Headers} headers
   * @param {string} body
   * @returns {Response}
   */
  const stripe = (path, method, headers, body) => {
    if (headers.get('authorization') !== `Bearer ${STRIPE_KEY}`) return globalThis.Response.json({ error: { message: 'bad key' } }, { status: 401 });
    if (method === 'GET' && path === `/prices/${PRICE}`) {
      return globalThis.Response.json({ id: PRICE, object: 'price', active: true, ...AMOUNT, recurring: null, type: 'one_time' });
    }
    if (method === 'POST' && path === '/checkout/sessions') {
      seq += 1;
      const id = `cs_test_sudokuoku${seq}`;
      sessions.set(id, new URLSearchParams(body));
      return globalThis.Response.json({ id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    unexpected.push(`${method} stripe ${path}`);
    return globalThis.Response.json({ error: { message: 'unknown endpoint' } }, { status: 404 });
  };

  /** @type {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} */
  const fetch = async (input, init = {}) => {
    const url = String(input instanceof globalThis.Request ? input.url : input);
    const method = init.method ?? 'GET';
    const headers = new globalThis.Headers(init.headers);
    const body = typeof init.body === 'string' ? init.body : '';
    calls.push(`${method} ${url}`);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs' && method === 'GET') {
      return globalThis.Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'public, max-age=3600' } });
    }
    if (url === 'https://oauth2.googleapis.com/token' && method === 'POST') return token(body);
    if (url.startsWith('https://api.stripe.com/v1/')) return stripe(url.slice('https://api.stripe.com/v1'.length), method, headers, body);
    unexpected.push(`${method} ${url}`);
    throw new TypeError(`fetch to an address the fakes do not serve: ${url}`);
  };

  return {
    fetch,
    calls,
    unexpected,
    sessions,
    /**
     * Google's half of a sign-in: the authorize URL the kit sent the browser to, checked as
     * Google checks it, and the callback URL Google sends the browser back to, with a code the
     * token endpoint exchanges once for an ID token naming `person`.
     * @param {string} authorizeUrl
     * @param {Person} [person]
     * @returns {URL}
     */
    consent(authorizeUrl, person = { sub: '1001', email: 'ada@example.com' }) {
      const url = new URL(authorizeUrl);
      const params = url.searchParams;
      if (`${url.origin}${url.pathname}` !== 'https://accounts.google.com/o/oauth2/v2/auth') throw new Error(`not Google's authorize URL: ${authorizeUrl}`);
      if (params.get('client_id') !== CLIENT_ID || params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || params.get('scope') !== 'openid email') {
        throw new Error(`an authorize URL Google would refuse: ${authorizeUrl}`);
      }
      seq += 1;
      const code = `code${seq}`;
      codes.set(code, { challenge: params.get('code_challenge') ?? '', redirectUri: params.get('redirect_uri') ?? '', nonce: params.get('nonce') ?? '', person });
      const back = new URL(params.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', params.get('state') ?? '');
      return back;
    },
    /**
     * The `checkout.session.completed` event Stripe sends once the session `checkoutUrl` names is
     * paid, built from what the kit asked for when it created that session.
     * @param {string} checkoutUrl
     * @returns {Record<string, unknown>}
     */
    paid(checkoutUrl) {
      const id = new URL(checkoutUrl).pathname.split('/').pop() ?? '';
      const asked = sessions.get(id);
      if (!asked) throw new Error(`no Checkout Session ${id}`);
      return {
        id: `evt_sudokuoku${id.replace(/[^0-9A-Za-z]/g, '')}`,
        object: 'event',
        type: 'checkout.session.completed',
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id,
            object: 'checkout.session',
            mode: asked.get('mode'),
            payment_status: 'paid',
            client_reference_id: asked.get('client_reference_id'),
            metadata: { app: asked.get('metadata[app]'), user: asked.get('metadata[user]'), product: asked.get('metadata[product]') },
            payment_intent: `pi_sudokuoku${id.replace(/[^0-9A-Za-z]/g, '')}`,
            customer: 'cus_sudokuoku1',
          },
        },
      };
    },
  };
}

/**
 * A webhook delivery as Stripe signs it: the body, and its Stripe-Signature header, an HMAC made
 * here with node:crypto rather than with the kit's own code.
 * @param {Record<string, unknown>} event
 * @param {{ secret?: string, at?: number }} [options]
 * @returns {{ body: string, signature: string }}
 */
export function signedDelivery(event, { secret = WEBHOOK_SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(event);
  const v1 = createHmac('sha256', secret).update(`${at}.${body}`).digest('hex');
  return { body, signature: `t=${at},v1=${v1}` };
}
