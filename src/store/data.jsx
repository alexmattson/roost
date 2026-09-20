import { createContext, useContext, useReducer, useMemo, useCallback, useState } from 'react';
import * as backend from '../lib/webbackend.js';
import { normalize, listVenues, dataBounds } from '../lib/analytics.js';
import { normalizeQuailSales } from '../lib/quail.js';
import { buildLedger } from '../lib/ledger.js';
import { buildVenueContext } from '../lib/resolve.js';
import { reconcile } from '../lib/reconcile.js';

/**
 * The single source of truth for account data.
 *
 * Raw API rows go into a reducer; everything derived from them — normalised
 * items, the reconciled ledger, POS sales, venue lists, the anomaly badge — is
 * computed with useMemo, so a component never recomputes them and two views can
 * never disagree. The imperative fetch/write logic is reused wholesale from
 * lib/webbackend.js; this layer just turns its results into React state.
 */

const DataContext = createContext(null);

const initialRaw = { items: [], quail: null, venueInfo: { stores: {}, booths: {} }, meta: null };

function rawReducer(state, action) {
  switch (action.type) {
    case 'load':
      return {
        items: action.items || [],
        quail: action.quail !== undefined ? action.quail : state.quail,
        venueInfo: action.venues || state.venueInfo,
        meta: action.meta || state.meta
      };
    case 'setItems':
      return { ...state, items: action.items };
    case 'reset':
      return initialRaw;
    default:
      return state;
  }
}

export function DataProvider({ children }) {
  const [raw, dispatch] = useReducer(rawReducer, initialRaw);
  const [status, setStatus] = useState(() => backend.webStatus());
  const [busy, setBusy] = useState(false);
  const [venueNames, setVenueNames] = useState(() => readVenueNames());

  const refreshStatus = useCallback(() => setStatus(backend.webStatus()), []);

  // --- derived, memoised ---------------------------------------------------
  const items = useMemo(() => normalize(raw.items), [raw.items]);
  const quailSales = useMemo(
    () => (raw.quail ? normalizeQuailSales(raw.quail.sales) : []),
    [raw.quail]
  );
  const ledgerResult = useMemo(
    () => buildLedger(items, quailSales, buildVenueContext(raw.venueInfo)),
    [items, quailSales, raw.venueInfo]
  );
  const ledger = ledgerResult.items;
  const ledgerSummary = ledgerResult.summary;
  const venueList = useMemo(() => listVenues(items), [items]);

  // The anomaly badge counts high-severity findings over the whole span.
  const badge = useMemo(() => {
    if (!quailSales.length) return { count: 0, urgent: false, sev: { high: 0, medium: 0, low: 0 } };
    const b = dataBounds(ledger.length ? ledger : items);
    const r = reconcile(items, quailSales, { start: b.min, end: Math.max(Date.now(), b.max) });
    const sev = {
      high: r.findings.filter((f) => f.severity === 'high').length,
      medium: r.findings.filter((f) => f.severity === 'medium').length,
      low: r.findings.filter((f) => f.severity === 'low').length
    };
    return { count: sev.high, urgent: sev.high > 0, sev };
  }, [items, quailSales, ledger]);

  // --- actions -------------------------------------------------------------
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await backend.webSend('refresh');
      if (!res || !res.ok) throw new Error((res && res.error) || 'The sync failed.');
      dispatch({ type: 'load', items: res.items, quail: res.quail, venues: res.venues, meta: res.meta });
      return res;
    } finally {
      setBusy(false);
    }
  }, []);

  const loadCache = useCallback(async () => {
    const res = await backend.webSend('getCache');
    if (res && res.ok && res.items && res.items.length) {
      dispatch({ type: 'load', items: res.items, quail: res.quail, venues: res.venues, meta: res.meta });
      return true;
    }
    return false;
  }, []);

  const applyEdits = useCallback(async (plans) => {
    const res = await backend.webSend('applyEdits', { plans });
    if (!res || !res.ok) throw new Error((res && res.error) || 'The edit request failed.');
    if (res.items) dispatch({ type: 'setItems', items: res.items });
    return res;
  }, []);

  const createItems = useCallback(async (rows) => {
    const res = await backend.webSend('createItems', { rows });
    if (!res || !res.ok) throw new Error((res && res.error) || 'The create request failed.');
    if (res.items) dispatch({ type: 'setItems', items: res.items });
    return res;
  }, []);

  const deleteItems = useCallback(async (ids) => {
    const res = await backend.webSend('deleteItems', { ids });
    if (!res || !res.ok) throw new Error((res && res.error) || 'The delete request failed.');
    if (res.items) dispatch({ type: 'setItems', items: res.items });
    return res;
  }, []);

  const printBarcodes = useCallback(async (opts) => {
    return backend.generateBarcodeFile(opts);
  }, []);

  const connectSandpiper = useCallback(async (creds) => {
    const r = await backend.connectSandpiper(creds);
    refreshStatus();
    return r;
  }, [refreshStatus]);

  const connectQuail = useCallback(async (creds) => {
    const r = await backend.connectQuail(creds);
    refreshStatus();
    return r;
  }, [refreshStatus]);

  const signOut = useCallback(() => {
    backend.signOutWeb();
    dispatch({ type: 'reset' });
    refreshStatus();
  }, [refreshStatus]);

  const renameVenue = useCallback((id, name) => {
    setVenueNames((prev) => {
      const next = { ...prev, [id]: name };
      try { localStorage.setItem('sp_venue_names', JSON.stringify(next)); } catch (e) { /* cosmetic */ }
      return next;
    });
  }, []);

  const value = {
    // raw + derived
    raw, items, quailSales, ledger, ledgerSummary, venueList, venueInfo: raw.venueInfo,
    venueNames, meta: raw.meta, badge, hasData: items.length > 0,
    status, busy,
    // actions
    refresh, loadCache, applyEdits, createItems, deleteItems, printBarcodes,
    connectSandpiper, connectQuail, signOut, refreshStatus, renameVenue
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within a DataProvider');
  return ctx;
}

function readVenueNames() {
  try { return JSON.parse(localStorage.getItem('sp_venue_names') || '{}'); } catch (e) { return {}; }
}
