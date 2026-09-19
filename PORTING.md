# Roost → React port

This branch (`react-port`) moves Roost from the hand-rolled vanilla-JS app to a
React + Vite build, without a rewrite of the logic. The live site on `main` is
untouched until this reaches parity and is merged.

## Why it's low-risk

About 60% of the codebase is pure, framework-agnostic logic and moves across
**unchanged**. Everything in `src/lib/` — `analytics`, `ledger`, `quail`,
`reconcile`, `resolve`, `stock`, `core`, `webbackend`, `barcode`, and the
hand-rolled SVG `charts` — is the same code that ships today. React never
touches it. What changes is only the rendering layer (the old `popup.js`), which
becomes components, and how the charts get mounted (a `<Chart>` wrapper calls the
imperative builder against a ref).

## Architecture

```
index.html            Vite entry, sets theme before paint, mounts #root
src/main.jsx          React root + global styles
src/App.jsx           auth gate → dashboard shell → active page
src/store/
  data.jsx            DataProvider: raw API rows in a reducer; normalised items,
                      the reconciled ledger, POS sales, venue lists and the
                      anomaly badge all derived with useMemo. Actions wrap
                      webbackend (refresh, applyEdits, createItems, deleteItems,
                      connect, signOut).
  nav.jsx             NavProvider: mode/tab/range/venue, per-mode range memory.
src/hooks/useTheme.js light/dark, persisted, applied to <html>.
src/components/       ui (Button, Card, Pill, Kpi, Banner), Shell (TopBar,
                      ModesNav, RangeBar, Tabs, LoadingState), Chart, Brand.
src/pages/            LoginGate, Home (done), Placeholder (stubs).
src/styles/           theme.css (the refined design system, reused as-is) +
                      app.css (web layout for #root).
```

**Data flow:** one `DataProvider` holds raw rows; all derived data is memoised so
no component recomputes it and two views can't disagree — the same "one ledger"
guarantee the vanilla app had, now enforced by `useMemo` dependencies instead of
a manual `rebuildLedger()`. Navigation state is separate, so changing the date
window never invalidates the ledger.

## Status

Done and building:
- Toolchain (Vite), CI deploy to Pages (`.github/workflows/deploy.yml`)
- Design system, component library, theme
- Data + nav stores wired to the reused logic
- Login gate, app shell (top bar, nav, range bar, tabs, badges, severity pills)
- **Home** page — fully ported: month-to-date take-home, the celebratory
  new-sales sync card with one-click sync, the attention list, recent sales.

Remaining (each is now a mechanical port against the established pattern — the
logic already exists in `src/lib`):
- **Analyze** — Overview/Sales/Inventory/Catalog/Venues KPIs, tables and the
  ~9 charts (each a `<Chart draw={el => barChart(el, …)} />`).
- **Records → Inventory** — the editable table, add-stock sheet, print tags.
- **Records → POS sales** — the register ledger table.
- **Records → Sync** — anomalies table, bulk fixes, match tooltip.

## Deploying

The build ships to GitHub Pages via Actions, not committed files. After merge to
`main`, set **Settings → Pages → Source → GitHub Actions** (once). Local:

```bash
npm install
npm run dev      # http://localhost:5173/roost/
npm run build    # → dist/
```
