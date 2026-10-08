/* Sudokuoku on the web: the safety net. index.html loads this file before the app's bundle,
   and it depends on nothing, so that when the bundle fails to load (a network error, a host
   that did not publish it, a policy that blocks it), throws while it starts, or cannot be
   parsed by an old browser, the visitor reads a short note with a way to reload instead of
   an empty page. The note is #startup-failed in index.html; this file only shows and hides
   it, through the `hidden` property, so it needs no markup from a string. */
(function () {
  'use strict';

  const GRACE_MS = 4000; // after the page has loaded, how long the app has to draw something
  let failed = false;

  function root() {
    return document.getElementById('root');
  }

  // The app is up when React has drawn anything at all into #root.
  function drawn() {
    const el = root();
    return !!el && el.childElementCount > 0;
  }

  function update() {
    const note = document.getElementById('startup-failed');
    if (note) note.hidden = !(failed && !drawn());
  }

  function fail() {
    failed = true;
    update();
  }

  // Capture phase, so a <script> that fails to load (its error event does not bubble) is seen
  // too; another element that fails to load, an image, leaves the app running and is ignored.
  // An error only counts when nothing is drawn: either the app never started, or React unmounted
  // the whole tree after an error it could not recover from, which it reports here as well. A
  // stray error behind a working board leaves the board alone.
  window.addEventListener(
    'error',
    function (event) {
      const target = event.target;
      if (target && target !== window && target.tagName !== 'SCRIPT') return;
      setTimeout(function () {
        if (!drawn()) fail();
      }, 0);
    },
    true
  );
  window.addEventListener('unhandledrejection', function () {
    setTimeout(function () {
      if (!drawn()) fail();
    }, 0);
  });

  // A script the policy refused, or a bundle that ran and drew nothing, fires no error at all:
  // so once the page has loaded, the app gets a few seconds to draw before the note shows.
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!drawn()) fail();
    }, GRACE_MS);
  });

  // The note goes away the moment the app draws, so a slow start that recovers is not left
  // under a message saying it failed.
  document.addEventListener('DOMContentLoaded', function () {
    const el = root();
    if (el && typeof MutationObserver === 'function') {
      new MutationObserver(update).observe(el, { childList: true });
    }
    update();
  });
})();
