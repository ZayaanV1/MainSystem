/* Applied before first paint. Built from this template by the theme-init plugin in vite.config.ts, which writes each theme ground in from tokens.css. External rather than inline so the CSP can say script-src 'self' with no hash to keep in step with the tokens. */
(function () {
  var GROUNDS = __THEME_GROUNDS__;
  try {
    var root = document.documentElement;
    var c = localStorage.getItem('planner.theme');
    if (c === 'light' || c === 'dark') root.setAttribute('data-theme', c);
    var s = localStorage.getItem('planner.skin');
    if (!GROUNDS[s] || s === 'cloisonne') s = 'cloisonne';
    else root.setAttribute('data-skin', s);
    var dark =
      c === 'dark' ||
      (c !== 'light' && !window.matchMedia('(prefers-color-scheme: light)').matches);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', GROUNDS[s][dark ? 0 : 1]);
  } catch {
    /* storage unavailable — the media query still decides */
  }
})();
