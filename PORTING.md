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

## Status — complete

Every page is ported and the app builds and passes its render tests.

- Toolchain (Vite), CI deploy to Pages (`.github/workflows/deploy.yml`)
- Design system, component library, theme
- Data + nav stores wired to the reused logic
- Login gate, app shell (top bar, nav, range bar with the Sync explainer, tabs,
  Records badge, severity pills, loading state)
- **Home** — month-to-date take-home, the celebratory new-sales sync card with
  one-click sync, attention list, recent sales
- **Analyze** — Overview, Sales, Inventory, Catalog, Venues: every KPI, table
  and chart, with the $/units toggles and editable venue names
- **Records → Inventory** — the fixed-layout editable table (click-to-edit,
  delete confirmation), the batch add-stock sheet with lot-splitting and price
  hints, and print tags with Code 128 barcodes
- **Records → POS sales** — the searchable register ledger
- **Records → Sync** — anomalies table, filters, single and bulk fixes with the
  confirm flow, and the match tooltip

### Tests

`npm test` mounts the whole app against seeded session + cache data and asserts
Home, Analyze, Sync and Inventory all render — real runtime coverage, not just a
compile. `src/__tests__/smoke.test.jsx`.

## Deploying

The build ships to GitHub Pages via Actions, not committed files. After merge to
`main`, set **Settings → Pages → Source → GitHub Actions** (once). Local:

```bash
npm install
npm run dev      # http://localhost:5173/roost/
npm run build    # → dist/
npm test         # render smoke tests
```
