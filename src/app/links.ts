/**
 * Challenge links: the code a URL carries, and taking it back out of the
 * page's address. These shapes reach the app: `sudokuoku://c/<code>` from an
 * installed app, the website's own address with `#/c/<code>` after its path
 * (a hash, so a static host keeps serving the app), and the older forms with
 * `/c/<code>` as the path or `?/c/<code>` as the query. The code itself is
 * validated by decodeChallenge, and what a code may do to the one challenge
 * slot is receiveChallenge's (src/engine/challenge.ts).
 *
 * No React or React Native here: this is what makes it testable.
 */
import { withoutChallengeLink } from '../utils/challengeInput';

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
  const raw = match?.[1];
  return raw === undefined ? null : sanitizeCode(raw);
}

/**
 * Takes a challenge link out of the page's address, in whichever form it is
 * there (withoutChallengeLink), so a reload does not read it again. When is the
 * game screen's to decide. Web only: without a window or history it does
 * nothing, so native and tests are unaffected, and a browser that refuses the
 * rewrite (Safari throws past a hundred calls in ten seconds) leaves the
 * address as it was rather than throwing out of the screen. Returns whether the
 * address changed.
 */
export function clearChallengeLinkFromUrl(): boolean {
  if (typeof window === 'undefined' || !window.location || !window.history) return false;
  const { location, history } = window;
  if (typeof history.replaceState !== 'function' || typeof location.href !== 'string') return false;
  try {
    const next = withoutChallengeLink(location.href);
    if (next === location.href) return false;
    history.replaceState(history.state, '', next);
    return true;
  } catch {
    return false;
  }
}
