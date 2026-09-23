import { useEffect, useRef, useState } from 'react';
import { DataProvider, useData } from './store/data.jsx';
import { NavProvider, useNav } from './store/nav.jsx';
import { ThemeProvider, useTheme } from './hooks/useTheme.jsx';
import { ToastProvider, useToast } from './store/toast.jsx';
import { LoginGate } from './pages/LoginGate.jsx';
import { TopBar, RangeBar, Tabs, ChromeMini, LoadingState } from './components/Shell.jsx';
import { Home } from './pages/Home.jsx';
import { Sync } from './pages/Sync.jsx';
import { PosSales } from './pages/PosSales.jsx';
import { Inventory } from './pages/Inventory.jsx';
import { Analyze } from './pages/Analyze.jsx';
import { AddStock } from './pages/AddStock.jsx';
import { ManageChannels } from './pages/ManageChannels.jsx';
import { useTooltips } from './hooks/useTooltips.js';
import { useChromeCollapse } from './hooks/useChromeCollapse.js';

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <DataProvider>
          <Root />
        </DataProvider>
      </ToastProvider>
    </ThemeProvider>
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
  const { theme } = useTheme();
  // ThemeProvider re-syncs the palette on a theme change; remount the pages
  // (key) so every chart — even ones whose data didn't change — rebuilds its
  // series with the new colours.
  useTooltips();
  const { mode } = useNav();
  // Collapse the tab/filter chrome on scroll (desktop + mobile); Home is the
  // landing view, so keep its nav fixed with no collapse/breadcrumb.
  useChromeCollapse(mode !== 'home');
  const [firstFetching, setFirstFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();
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
        catch (e) { toast('error', e.message || String(e), 0); }
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
      if (v.errors && v.errors.length) {
        toast('info', `Synced ${res.meta.count} items, ${v.errors.length} venue lookup(s) failed.`);
      } else {
        toast('ok', `Synced ${res.meta.count} items${res.quail ? ` · ${res.quail.sales.length} POS sales` : ''}.`);
      }
    } catch (e) {
      toast('error', e.message || String(e), 0);
    } finally {
      setRefreshing(false);
      setFirstFetching(false);
    }
  };

  return (
    <>
      <TopBar onRefresh={doRefresh} refreshing={refreshing} />
      <div className="app-chrome">
        <div className="app-chrome-inner">
          <Tabs />
          <RangeBar />
        </div>
      </div>
      <ChromeMini />
      <main id="main" key={theme}>
        {firstFetching && !hasData ? <LoadingState /> : <Page />}
      </main>
      <AddStockHost />
      <ManageChannelsHost />
    </>
  );
}

function ManageChannelsHost() {
  const { manageChannelsOpen, closeManageChannels } = useNav();
  if (!manageChannelsOpen) return null;
  return <ManageChannels onClose={closeManageChannels} />;
}

/** Add stock is a full-screen sheet openable from anywhere (Home, Inventory),
 *  so it lives at the app level rather than inside one page. */
function AddStockHost() {
  const { addStockOpen, closeAddStock } = useNav();
  if (!addStockOpen) return null;
  return <AddStock onClose={closeAddStock} />;
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
