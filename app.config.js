// app.json is the whole configuration. This file lets one command publish the web build
// under a sub-path (a GitHub Pages project site serves it at /sudokuoku/) without editing
// app.json: WEB_BASE_PATH=/sudokuoku sets experiments.baseUrl, which prefixes every URL the
// export writes, for that run alone. Unset, as it is for every native build, the
// configuration is app.json's, untouched (src/__tests__/website.test.ts holds both).
const BASE_PATH = /^(\/[A-Za-z0-9._~-]+)+$/;

module.exports = ({ config }) => {
  const base = process.env.WEB_BASE_PATH;
  if (base === undefined || base === '' || base === '/') return config;
  if (!BASE_PATH.test(base) || base.split('/').some((s) => s === '.' || s === '..')) {
    throw new Error(`WEB_BASE_PATH must be a path such as /sudokuoku, without a trailing slash: ${JSON.stringify(base)}`);
  }
  return { ...config, experiments: { ...config.experiments, baseUrl: base } };
};
