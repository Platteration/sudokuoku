/**
 * What the About card says. Free of React Native so a test can hold each
 * line to what is true: the sentence is the package description, the source
 * link is the repository, and the privacy line is backed by the app config
 * test, which checks the source for network code.
 */
export const APP_NAME = 'Sudokuoku';
export const TAGLINE = 'Sudoku that shifts under you after every move, and stays solvable.';
export const LICENCE = 'MIT licence';
export const SOURCE_URL = 'https://github.com/Platteration/sudokuoku';
export const PRIVACY = 'Nothing leaves your device: no account, no analytics, no network code.';

/** The version the build carries, or a placeholder a missing config cannot be mistaken for. */
export function appVersion(configured: unknown): string {
  return typeof configured === 'string' && configured.length > 0 ? configured : '0.0.0';
}
