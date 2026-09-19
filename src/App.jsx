import { useEffect, useRef, useState } from 'react';
import { DataProvider, useData } from './store/data.jsx';
import { NavProvider, useNav } from './store/nav.jsx';
import { LoginGate } from './pages/LoginGate.jsx';
import { TopBar, ModesNav, RangeBar, Tabs, LoadingState } from './components/Shell.jsx';
import { Home } from './pages/Home.jsx';
import { Sync } from './pages/Sync.jsx';
import { PosSales } from './pages/PosSales.jsx';
import { Inventory } from './pages/Inventory.jsx';
import { Analyze } from './pages/Analyze.jsx';
import { useTooltips } from './hooks/useTooltips.js';

export default function App() {
  return (
    <DataProvider>
      <Root />
    </DataProvider>
  );
}

function Root() {
  const { status } = useData();
  // Returning sessions skip the gate; a fresh connect does not — you stay on the
  // login screen until you press Enter Roost.
  const [entered, setEntered] = useState(() => status.sandpiper.connected);

  // Signing out drops the session, so fall back to the gate.
  useEffect(() => {
    if (!status.sandpiper.connected) setEntered(false);
  }, [status.sandpiper.connected]);

  if (!entered) {
    return <LoginGate onEnter={() => setEntered(true)} />;
  }
  return (
    <NavProvider>
      <Dashboard />
    </NavProvider>
  );
}

function Dashboard() {
  const { hasData, loadCache, refresh } = useData();
  useTooltips();
  const [firstFetching, setFirstFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState(null);
  const booted = useRef(false);

  // On first mount: load the cache, and if there's nothing cached, fetch.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const had = await loadCache();
      if (!had) {
        setFirstFetching(true);
        try { await refresh(); }
        catch (e) { setBanner({ kind: 'error', text: e.message || String(e) }); }
        finally { setFirstFetching(false); }
      }
    })();
  }, [loadCache, refresh]);

  const doRefresh = async () => {
    setRefreshing(true);
    if (!hasData) setFirstFetching(true);
    try {
      const res = await refresh();
      const v = res.venues || { errors: [] };
      setBanner(v.errors && v.errors.length
        ? { kind: 'info', text: `Synced ${res.meta.count} items, ${v.errors.length} venue lookup(s) failed.` }
        : { kind: 'ok', text: `Synced ${res.meta.count} items${res.quail ? ` · ${res.quail.sales.length} POS sales` : ''}.` });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message || String(e) });
    } finally {
      setRefreshing(false);
      setFirstFetching(false);
    }
  };

  return (
    <>
      <TopBar onRefresh={doRefresh} refreshing={refreshing} />
      {banner && <div className={`banner ${banner.kind}`}><span>{banner.text}</span><button className="banner-x" onClick={() => setBanner(null)} aria-label="Dismiss">×</button></div>}
      <ModesNav />
      <RangeBar />
      <Tabs />
      <main id="main">
        {firstFetching && !hasData ? <LoadingState /> : <Page />}
      </main>
    </>
  );
}

function Page() {
  const { mode, tab } = useNav();
  const { hasData } = useData();
  if (!hasData) {
    return <div className="empty-state"><h3>No data yet</h3><p>Hit <b>Fetch latest data</b> to pull your inventory and build the dashboard.</p></div>;
  }
  if (mode === 'home') return <Home />;
  if (mode === 'analyze') return <Analyze tab={tab} />;
  if (mode === 'records') {
    if (tab === 'items') return <Inventory />;
    if (tab === 'pos') return <PosSales />;
    if (tab === 'review') return <Sync />;
  }
  return null;
}
