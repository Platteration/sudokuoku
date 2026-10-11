/**
 * Challenge links: a code carried by a URL, and the rule for what to do with
 * it. Three shapes reach the app: `sudokuoku://c/<code>` from an installed
 * app, `https://<host>/<path>#/c/<code>` from the web build (a hash, so a
 * static host keeps serving the app), and the older `https://<host>/c/<code>`
 * path form. The code itself is validated by decodeChallenge.
 *
 * No React or React Native here: this is what makes the rule testable.
 */

/** Longer than any code the codec can produce; stops a hostile URL early. */
export const MAX_CODE_LENGTH = 16384;

function sanitizeCode(raw: string): string | null {
  if (!raw || raw.length > MAX_CODE_LENGTH) return null;
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.length <= MAX_CODE_LENGTH ? decoded : null;
  } catch {
    return raw;
  }
}

/** The challenge code a URL carries, or null when it carries none. */
export function challengeCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // The hash wins over the path, so an app served under a path that happens
  // to contain /c/ still opens the challenge it was sent.
  const match = /#\/c\/([^/?#]+)/.exec(url) ?? /\/c\/([^/?#]+)/.exec(url);
  return match ? sanitizeCode(match[1]) : null;
}

/** The attempt the app already holds for a challenge: on screen or parked. */
export interface HeldAttempt {
  /** The canonical code of that challenge (encodeChallenge of it). */
  code: string;
  status: 'playing' | 'won';
}

export type LinkDecision = 'start' | 'resume' | 'finished' | 'ignore';

/**
 * What a code arriving by link should do, given the attempt already held and
 * whether this session has consumed the same code before.
 *
 * A challenge is a single attempt, so a link never starts it twice: the same
 * code as the held attempt resumes it (or leaves a finished one on screen),
 * and a code consumed earlier this session is ignored once its attempt is
 * gone. Only a code the app has not acted on starts a new board.
 */
export function decideChallengeLink(
  code: string,
  held: HeldAttempt | null,
  consumed: boolean,
): LinkDecision {
  if (held && held.code === code) return held.status === 'playing' ? 'resume' : 'finished';
  if (consumed) return 'ignore';
  return 'start';
}

/**
 * Drops a consumed `#/c/<code>` hash from the address bar so a reload cannot
 * replay it over the saved board. Web only: without a window or history it
 * does nothing, so native and tests are unaffected. Returns whether the
 * address changed.
 */
export function clearChallengeLinkFromUrl(): boolean {
  if (typeof window === 'undefined' || !window.location || !window.history) return false;
  const { location, history } = window;
  if (typeof history.replaceState !== 'function') return false;
  if (typeof location.hash !== 'string' || !location.hash.startsWith('#/c/')) return false;
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return true;
  } catch {
    return false;
  }
}
