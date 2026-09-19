import { useState, useCallback, useEffect } from 'react';

/** Light/dark theme, persisted, applied to the document root. The initial value
 *  is already set before paint by the inline script in index.html. */
export function useTheme() {
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('sp_theme', theme); } catch (e) { /* cosmetic */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'light' ? 'dark' : 'light')), []);
  return { theme, toggle };
}
