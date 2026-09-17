/* Runs before first paint, so the page never flashes the wrong theme — or, on
 * the web, the dashboard before the sign-in screen. A classic, non-deferred
 * script on purpose, so it executes ahead of the body. */
(() => {
  let stored = null;
  try {
    stored = localStorage.getItem('sp_theme');
  } catch (e) { /* storage can be unavailable; fall back to the system preference */ }
  const system = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = stored || system;

  // Web build with no session yet: mark the document so CSS hides the app and
  // shows the gate immediately, rather than painting the shell then covering it.
  const isExtension = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  if (!isExtension) {
    let authed = false;
    try {
      const s = JSON.parse(sessionStorage.getItem('roost_web_session') || 'null');
      authed = !!(s && s.sandpiperToken);
    } catch (e) { /* no session — stay pre-auth */ }
    if (!authed) document.documentElement.classList.add('pre-auth');
  }
})();
