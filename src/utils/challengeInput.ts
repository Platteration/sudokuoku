/**
 * The challenge code in whatever a player pasted into the challenge sheet: a
 * bare code, a link (`sudokuoku://c/<code>`), or a link carrying the code as
 * `?code=`. What comes back still goes through decodeChallenge, which refuses
 * anything that is not a code.
 *
 * The text is not the app's: Paste from clipboard reads whatever is there,
 * of any length, and a page can put anything there when its text is copied.
 * So every step here is one pass over it.
 */
export function parseChallengeInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const fromQuery = /[?&#]code=([^&#]+)/.exec(trimmed);
  const fromQueryCode = fromQuery?.[1];
  if (fromQueryCode !== undefined) {
    try {
      return decodeURIComponent(fromQueryCode);
    } catch {
      return fromQueryCode;
    }
  }
  const afterSlash = trimmed.lastIndexOf('/') >= 0 ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
  return withoutQuery(afterSlash);
}

/**
 * `text` without its last line's query or fragment: cut at the first `?` or
 * `#` after the last line break. That is what `text.replace(/[?#].*$/, '')`
 * did, since `.` stops at a line break and `$` is the end of the text, but the
 * pattern found it by trying every `?` in turn, each one walking to the next
 * line break and back before failing: quadratic in the text. A pasted run of
 * 100,000 `?` and a second line held the page for 13 seconds in Chromium, and
 * the time grows with the square of the length.
 */
function withoutQuery(text: string): string {
  const lastBreak = Math.max(
    text.lastIndexOf('\n'),
    text.lastIndexOf('\r'),
    text.lastIndexOf('\u2028'),
    text.lastIndexOf('\u2029'),
  );
  for (let i = lastBreak + 1; i < text.length; i++) {
    if (text[i] === '?' || text[i] === '#') return text.slice(0, i);
  }
  return text;
}

/**
 * Where a link names a challenge: `/c/<code>`, the first one anywhere in it. The app's own link is
 * `sudokuoku://c/<code>`; the website reads the same out of its address, where a static host can
 * only answer for the one page, so the code rides in the query or the fragment
 * (`…/sudokuoku/?/c/<code>`, `…/sudokuoku/#/c/<code>`).
 */
export const CHALLENGE_LINK = /\/c\/([^/?#]+)/;

/**
 * The website's address without the challenge link in it: the path cut before `/c/` when the
 * link is there, and the query or the fragment dropped when it holds one. A browser keeps a
 * followed link in the address bar and a reload reads it again, which is how a reload carries on
 * with the challenge it names; once that challenge is won, or another has taken the slot, the
 * game puts this address in its place, so a reload does not start it over.
 */
export function withoutChallengeLink(href: string): string {
  const url = new URL(href);
  const at = url.pathname.search(CHALLENGE_LINK);
  if (at >= 0) url.pathname = url.pathname.slice(0, at + 1);
  if (CHALLENGE_LINK.test(url.search)) url.search = '';
  if (CHALLENGE_LINK.test(url.hash)) url.hash = '';
  return url.href;
}
