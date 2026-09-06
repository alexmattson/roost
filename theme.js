/* Runs before paint so the popup never flashes the wrong theme.
 * Must stay a classic script — MV3's CSP forbids inline <script>. */
(() => {
  let stored = null;
  try {
    stored = localStorage.getItem('sp_theme');
  } catch (e) { /* storage can be unavailable; fall back to the system preference */ }
  const system = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = stored || system;
})();
