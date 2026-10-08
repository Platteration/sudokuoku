/**
 * Builds the website: the Expo web export with the hosting files from public/ beside it, one
 * folder to publish as it is.
 *
 *   npm run build:web                                  # dist/, served from a domain's root
 *   WEB_BASE_PATH=/sudokuoku npm run build:web          # served under /sudokuoku/
 *   node scripts/build-web.mjs --out .web-build
 *
 * `expo export` empties its output folder before it writes, so `--out` inside the checkout is
 * dist, web-build or .web-build and nothing else (`--out src` would delete the source), and a
 * folder outside it may be anything but one that holds the checkout.
 *
 * `expo export` does most of it: it copies public/ (dot-folders included) into the output,
 * renders index.html from public/index.html, and, with WEB_BASE_PATH set (app.config.js turns
 * it into experiments.baseUrl), prefixes every URL it writes. The rest is this script's. It
 * writes the policy `_headers` sends into both pages as a <meta>, for a host that sends no
 * headers (it is kept out of the template, which the dev server serves too); prefixes the URLs
 * that public/'s own pages and Apache's error pages write, which Expo does not touch; removes
 * metadata.json, Expo's manifest for update servers, which the page never reads and so is not
 * part of the site; and fails when a hosting file did not arrive, so an SDK that stopped copying
 * one breaks the build rather than a deploy.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { metaPolicy } from './headers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** What every build publishes beside the app, all of it from public/. */
export const HOSTING_FILES = ['_headers', '_redirects', '.htaccess', '404.html', 'robots.txt', '.well-known/security.txt', 'guard.js'];

/** The pages public/ supplies: they get the policy, and the base path in their site-absolute URLs. */
const PAGES = ['index.html', '404.html'];

/** The folders inside the checkout a build may be written to: .gitignore lists each one. */
export const OUT_FOLDERS = ['dist', 'web-build', '.web-build'];

/**
 * Why the build may not write to `out`, or null when it may. `expo export` deletes its output
 * folder before it writes, and refuses only the project folder itself and the folders above it:
 * `--out src` emptied src/ and left public/'s files in its place. Inside the checkout the site
 * goes to one of the ignored build folders and nowhere else; outside it, anywhere but a folder
 * that holds the checkout.
 */
export function outRefusal(checkout, out) {
  if (within(checkout, out)) {
    const inside = relative(checkout, out);
    return OUT_FOLDERS.includes(inside)
      ? null
      : `--out inside the repository is one of ${OUT_FOLDERS.join(', ')}, because the export deletes the folder first; not ${JSON.stringify(inside || '.')}`;
  }
  return within(out, checkout) ? `--out ${out} holds the repository, which the export would delete` : null;
}

/** Whether `path` is `folder` or inside it, by whole path segments (`..cache` is a name, not a step up). */
function within(folder, path) {
  const rel = relative(folder, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * `html` with every site-absolute `href` and `src` moved under `base` ('' for a domain root).
 * A URL already under `base` is Expo's own (the bundle, the favicon) and is left alone, and so is
 * one that is not site-absolute: `//host` names another origin, and a relative or empty one
 * already follows the page.
 */
export function withBase(html, base) {
  if (!base) return html;
  return html.replace(/\b(href|src)="(\/(?!\/)[^"]*)"/g, (whole, attr, url) =>
    url === base || url.startsWith(`${base}/`) ? whole : `${attr}="${base}${url}"`
  );
}

const CHARSET = '<meta charset="utf-8" />';

/** `html` with `policy` as its Content-Security-Policy <meta>, first thing after the charset. */
export function withPolicy(html, policy) {
  if (html.split(CHARSET).length !== 2) throw new Error(`a page needs exactly one ${CHARSET} to put the policy after`);
  if (/http-equiv="Content-Security-Policy"/i.test(html)) throw new Error('a page already carries a policy of its own');
  return html.replace(CHARSET, `${CHARSET}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const out = resolve(root, at === -1 ? 'dist' : (args[at + 1] ?? ''));
  if (at !== -1 && !args[at + 1]) throw new Error('--out needs a directory');
  const refusal = outRefusal(root, out);
  if (refusal) {
    console.error(`build-web: ${refusal}`);
    process.exit(1);
  }
  // app.config.js validates the value; '' and '/' both mean a domain root.
  const base = (process.env.WEB_BASE_PATH ?? '').replace(/\/+$/, '');

  const cli = createRequire(join(root, 'package.json')).resolve('expo/bin/cli');
  const run = spawnSync(process.execPath, [cli, 'export', '--platform', 'web', '--output-dir', out], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
  });
  if (run.status !== 0) process.exit(run.status ?? 1);

  const missing = HOSTING_FILES.filter((f) => !existsSync(join(out, f)));
  if (missing.length > 0) throw new Error(`the export left out ${missing.join(', ')}: expo export no longer copies public/ whole`);
  rmSync(join(out, 'metadata.json'), { force: true });
  const policy = metaPolicy(readFileSync(join(out, '_headers'), 'utf8'));
  for (const page of PAGES) {
    const file = join(out, page);
    writeFileSync(file, withPolicy(withBase(readFileSync(file, 'utf8'), base), policy));
  }
  // Apache takes the error page as a URL path from the server's root.
  const htaccess = join(out, '.htaccess');
  writeFileSync(htaccess, readFileSync(htaccess, 'utf8').replace(/^(ErrorDocument \d+ )\//gm, `$1${base}/`));
  console.log(`Website built in ${out}${base ? `, for ${base}/` : ', for a domain root'}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
