import { Brand } from './Brand.jsx';
import { useData } from '../store/data.jsx';
import { useNav, MODES, modeById } from '../store/nav.jsx';
import { useTheme } from '../hooks/useTheme.js';
import { int } from '../lib/format.js';
import { relativeTime } from '../lib/format.js';

export function TopBar({ onRefresh, refreshing }) {
  const { meta, badge, signOut } = useData();
  const { theme, toggle } = useTheme();
  const subline = meta
    ? `${meta.user || 'Signed in'} · ${int(meta.count)} items · updated ${relativeTime(meta.fetchedAt)}`
    : 'Not synced yet';

  return (
    <header className="topbar">
      <div className="brand">
        <Brand />
        <div className="brand-text">
          <h1>Roost</h1>
          <p id="subline">{subline}</p>
        </div>
      </div>
      <div className="top-actions">
        <button className="icon-btn" title="Switch theme" onClick={toggle} aria-label="Switch theme">
          {theme === 'light'
            ? <MoonIcon />
            : <SunIcon />}
        </button>
        <button className="icon-btn" title="Sign out" onClick={signOut} aria-label="Sign out"><SignOutIcon /></button>
        <button className={`btn primary ${refreshing ? 'loading' : ''}`} onClick={onRefresh} disabled={refreshing}>
          <RefreshIcon />
          <span>{refreshing ? 'Fetching…' : 'Fetch latest data'}</span>
        </button>
      </div>
    </header>
  );
}

export function ModesNav() {
  const { mode, selectMode } = useNav();
  const { badge } = useData();
  return (
    <nav className="modes" id="modes">
      {MODES.map((m) => (
        <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => selectMode(m.id)}>
          {m.label}
          {m.id === 'records' && badge.count > 0 && (
            <span className="mode-badge urgent" title={`${badge.count} high-priority to reconcile`}>
              {badge.count > 99 ? '99+' : badge.count}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

export function RangeBar() {
  const { mode, tab, active, range, setPreset, setCustomRange, venue, setVenue } = useNav();
  const { venueList } = useData();

  if (mode === 'home') return null;
  const isSync = tab === 'review';

  if (isSync) {
    return (
      <div className="rangebar">
        <span className="range-note">Sync compares your Sandpiper inventory against the Quail register, joined on inventory number, and lists everything that disagrees.</span>
      </div>
    );
  }

  const showVenue = (venueList.stores.length > 1 || venueList.booths.length > 1);
  const toInput = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const fromInput = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

  return (
    <div className="rangebar">
      <div className="chips">
        {active.presets.map(([k, label]) => (
          <button key={k} className={`chip ${range.preset === k ? 'active' : ''}`} onClick={() => setPreset(k)}>{label}</button>
        ))}
      </div>
      {showVenue && (
        <select className="venue-select" aria-label="Store or booth"
          value={venue.kind === 'all' ? 'all' : `${venue.kind}:${venue.id}`}
          onChange={(e) => {
            const v = e.target.value;
            setVenue(v === 'all' ? { kind: 'all', id: null } : { kind: v.slice(0, v.indexOf(':')), id: v.slice(v.indexOf(':') + 1) });
          }}>
          <option value="all">All venues</option>
          {venueList.stores.map((s) => <option key={s.id} value={`store:${s.id}`}>{s.label}</option>)}
          {venueList.booths.map((b) => <option key={b.id} value={`booth:${b.id}`}>{b.label}</option>)}
        </select>
      )}
      {range.preset === 'custom' && (
        <div className="custom-range">
          <input type="date" aria-label="From date" value={toInput(range.start)}
            onChange={(e) => setCustomRange(fromInput(e.target.value), range.end)} />
          <span className="dash">→</span>
          <input type="date" aria-label="To date" value={toInput(range.end)}
            onChange={(e) => setCustomRange(range.start, fromInput(e.target.value))} />
        </div>
      )}
    </div>
  );
}

export function Tabs() {
  const { mode, tab, active, selectTab } = useNav();
  const { badge } = useData();
  if (active.tabs.length < 2) return null;
  return (
    <nav className="tabs" id="tabs">
      {active.tabs.map(([id, label]) => (
        <button key={id} className={tab === id ? 'active' : ''} onClick={() => selectTab(id)}>
          {label}
          {id === 'review' && <SeverityPills sev={badge.sev} />}
        </button>
      ))}
    </nav>
  );
}

function SeverityPills({ sev }) {
  const order = [['high', 'sev-high'], ['medium', 'sev-med'], ['low', 'sev-low']];
  const shown = order.filter(([k]) => sev[k] > 0);
  if (!shown.length) return null;
  return (
    <span className="sev-pills">
      {shown.map(([k, cls]) => <span key={k} className={`sev-pill ${cls}`} title={`${sev[k]} ${k}`}>{sev[k]}</span>)}
    </span>
  );
}

export function LoadingState() {
  return (
    <div className="loading-state" style={{ display: 'grid' }}>
      <svg className="loading-spin" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
      <h3>Pulling your data…</h3>
      <p>Fetching inventory and reconciling it against the register. This can take a minute the first time.</p>
    </div>
  );
}

/* --- icons --- */
const SunIcon = () => <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const MoonIcon = () => <svg viewBox="0 0 24 24"><path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.8 6.8 0 0 0 10.8 10.8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>;
const SignOutIcon = () => <svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const RefreshIcon = () => <svg className="spin-target" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
