import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { DAY, dataBounds } from '../lib/analytics.js';
import { useData } from './data.jsx';

/**
 * Navigation and the date/venue window, kept out of the data store so a range
 * change never invalidates the derived ledger. Each mode remembers its own
 * range; Home and the Sync tab ignore it entirely.
 */

export const MODES = [
  { id: 'home', label: 'Home', tabs: [['home', 'Home']], presets: [], fullRange: true, defaultPreset: 'all' },
  {
    id: 'analyze', label: 'Analyze',
    tabs: [['overview', 'Overview'], ['sales', 'Sales'], ['inventory', 'Inventory'], ['catalog', 'Catalog'], ['venues', 'Venues']],
    presets: [['today', 'Today'], ['7d', '7D'], ['30d', '30D'], ['90d', '90D'], ['ytd', 'YTD'], ['12m', '1Y'], ['all', 'All time'], ['custom', 'Custom']],
    defaultPreset: 'all'
  },
  {
    id: 'records', label: 'Records',
    tabs: [['items', 'Inventory'], ['pos', 'POS sales'], ['review', 'Sync']],
    presets: [['90d', '90D'], ['12m', '1Y'], ['all', 'All time'], ['custom', 'Custom']],
    defaultPreset: '90d'
  }
];

export const modeById = (id) => MODES.find((m) => m.id === id) || MODES[0];

const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const endOfDay = (t) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); };

/** Resolves a preset to a {start, end} window against the data's real span. */
export function presetRange(preset, boundSource) {
  const bounds = dataBounds(boundSource);
  const end = endOfDay(Math.max(Date.now(), bounds.max));
  const now = new Date();
  let start;
  let clampToNow = false;
  switch (preset) {
    case 'today': start = startOfDay(Date.now()); clampToNow = true; break;
    case '7d': start = startOfDay(Date.now() - 7 * DAY); clampToNow = true; break;
    case '30d': start = startOfDay(Date.now() - 30 * DAY); break;
    case '90d': start = startOfDay(Date.now() - 90 * DAY); break;
    case '12m': { const d = new Date(); d.setFullYear(d.getFullYear() - 1); start = startOfDay(d.getTime()); break; }
    case 'ytd': start = new Date(now.getFullYear(), 0, 1).getTime(); break;
    case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); clampToNow = true; break;
    default: start = startOfDay(bounds.min);
  }
  return { start, end: clampToNow ? endOfDay(Date.now()) : end };
}

const NavContext = createContext(null);

export function NavProvider({ children }) {
  const { ledger, items } = useData();
  const boundSource = ledger.length ? ledger : items;

  const [mode, setMode] = useState(() => restore('sp_mode', 'home'));
  const [tabByMode, setTabByMode] = useState({});
  const [ranges, setRanges] = useState({});          // per-mode {preset, start, end}
  const [venue, setVenue] = useState({ kind: 'all', id: null });
  const [inventoryFilter, setInventoryFilter] = useState('all');
  const [addStockOpen, setAddStockOpen] = useState(false);

  const active = modeById(mode);
  const tab = tabByMode[mode] || restore('sp_tab_' + mode, active.tabs[0][0]);

  const range = useMemo(() => {
    if (active.fullRange) {
      const b = dataBounds(boundSource);
      return { preset: 'all', start: b.min, end: Math.max(Date.now(), b.max) };
    }
    return ranges[mode] || { preset: active.defaultPreset, ...presetRange(active.defaultPreset, boundSource) };
  }, [mode, ranges, active, boundSource]);

  const selectMode = useCallback((id) => { setMode(id); persist('sp_mode', id); }, []);
  const selectTab = useCallback((t) => {
    setTabByMode((prev) => ({ ...prev, [mode]: t }));
    persist('sp_tab_' + mode, t);
  }, [mode]);

  const setPreset = useCallback((preset) => {
    if (preset === 'custom') {
      setRanges((prev) => ({ ...prev, [mode]: { ...(prev[mode] || range), preset: 'custom' } }));
      return;
    }
    setRanges((prev) => ({ ...prev, [mode]: { preset, ...presetRange(preset, boundSource) } }));
  }, [mode, range, boundSource]);

  const setCustomRange = useCallback((start, end) => {
    setRanges((prev) => ({ ...prev, [mode]: { preset: 'custom', start, end: endOfDay(end) } }));
  }, [mode]);

  const goToInventory = useCallback((filter) => {
    setInventoryFilter(filter || 'all');
    setMode('records'); persist('sp_mode', 'records');
    setTabByMode((prev) => ({ ...prev, records: 'items' }));
  }, []);

  const goToSync = useCallback(() => {
    setMode('records'); persist('sp_mode', 'records');
    setTabByMode((prev) => ({ ...prev, records: 'review' }));
  }, []);

  const value = {
    mode, tab, range, venue, active, inventoryFilter, addStockOpen,
    selectMode, selectTab, setPreset, setCustomRange, setVenue, setInventoryFilter,
    goToInventory, goToSync,
    openAddStock: () => setAddStockOpen(true),
    closeAddStock: () => setAddStockOpen(false)
  };

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used within a NavProvider');
  return ctx;
}

function restore(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
function persist(key, val) {
  try { localStorage.setItem(key, val); } catch (e) { /* nav state is a convenience */ }
}
