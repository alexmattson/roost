import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { refreshPalette } from '../lib/charts.js';

/**
 * Theme as shared state, so the toggle in the top bar re-renders everything
 * that depends on it — including the charts, which read the palette during
 * render. The document attribute and the chart palette are updated *during*
 * this provider's render, before any descendant renders, so a chart built in
 * the same commit reads the new theme's colours (an effect would run too late,
 * after the children had already rendered with the old palette). Persisting to
 * storage stays in an effect. Initial value is set pre-paint by index.html.
 */
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  );

  useMemo(() => {
    document.documentElement.dataset.theme = theme;
    refreshPalette();
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem('sp_theme', theme); } catch (e) { /* cosmetic */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'light' ? 'dark' : 'light')), []);
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
