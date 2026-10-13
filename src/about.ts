/**
 * What the About card says. Free of React Native so a test can hold each
 * line to what is true: the sentence is the package description, the source
 * link is the repository, and the privacy lines are backed by the app config
 * test, which checks the source for network code (the website's account
 * client, src/accountClient.web.ts, which a phone never gets, aside) and for
 * any URL but this one.
 */
export const APP_NAME = 'Sudokuoku';
export const TAGLINE = 'Sudoku that shifts under you after every move, and stays solvable.';
export const LICENCE = 'MIT licence';
export const SOURCE_URL = 'https://github.com/Platteration/sudokuoku';
/** In the iOS and Android apps, which hold no network code at all. */
export const PRIVACY = 'Nothing leaves your device: no account, no analytics, no network code.';
/**
 * On the website when its host offers no sign-in (GitHub Pages, a plain static host): the page
 * asks its own site once whether it does (api/config), which carries nothing of the player's,
 * and keeps every game in the browser.
 */
export const PRIVACY_WEB = 'Nothing leaves your device: no account, no analytics, and your games stay in this browser.';
/**
 * On the website when its host offers sign-in (server/kit behind api/): what signing in and
 * paying tell the site, and what it keeps. The email is kept in the session record alone, which
 * signing out deletes and which ends after thirty days.
 */
export const PRIVACY_WITH_ACCOUNT =
  "Nothing leaves your device unless you sign in or buy. Signing in with Google tells this site an account id and your email address; a payment goes through Stripe, which handles it. The site keeps the account id, what was bought and Stripe's customer id, and your email address only while you are signed in. Your games stay in this browser.";
/** What About says to a visitor the site's api/ reports as a supporter. Nothing else changes for them. */
export const SUPPORTER_THANKS = 'Thank you for supporting Sudokuoku.';

/** The version the build carries, or a placeholder a missing config cannot be mistaken for. */
export function appVersion(configured: unknown): string {
  return typeof configured === 'string' && configured.length > 0 ? configured : '0.0.0';
}
