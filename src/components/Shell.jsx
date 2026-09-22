import { useState, useEffect, useRef } from 'react';
import { Brand } from './Brand.jsx';
import { PillNav } from './PillNav.jsx';
import { Select } from './Select.jsx';
import { useData } from '../store/data.jsx';
import { useNav, MODES, modeById } from '../store/nav.jsx';
import { useTheme } from '../hooks/useTheme.jsx';
import { relativeTime } from '../lib/format.js';

export function TopBar({ onRefresh, refreshing }) {
  const { meta, signOut } = useData();
  const { openManageChannels } = useNav();
  const { theme, toggle } = useTheme();
  const updated = meta ? relativeTime(meta.fetchedAt) : null;

  return (
    <header className="topbar">
      <div className="brand">
        <Brand />
        <div className="brand-text">
          <h1>Roost</h1>
        </div>
      </div>
      <div className="topbar-modes"><ModesNav /></div>
      <div className="top-actions">
        {updated && <span className="fetch-when" title={`Data last fetched ${updated}`}>Updated {updated}</span>}
        <button className={`btn primary ${refreshing ? 'loading' : ''}`} onClick={onRefresh} disabled={refreshing}
          aria-label={refreshing ? 'Fetching latest data' : 'Fetch latest data'}>
          <RefreshIcon />
          <span className="btn-label">{refreshing ? 'Fetching…' : 'Fetch latest data'}</span>
        </button>
        <AccountMenu meta={meta} theme={theme} toggleTheme={toggle}
          onManage={openManageChannels} onSignOut={signOut} />
      </div>
    </header>
  );
}

function AccountMenu({ meta, theme, toggleTheme, onManage, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="acct-menu" ref={ref}>
      <button className="icon-btn" aria-haspopup="menu" aria-expanded={open} title="Account & settings"
        aria-label="Account and settings menu" onClick={() => setOpen((o) => !o)}><MenuIcon /></button>
      {open && (
        <div className="acct-pop" role="menu">
          {meta && meta.user && <div className="acct-who" title={meta.user}>{meta.user}</div>}
          <button role="menuitem" className="acct-item" onClick={toggleTheme}>
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            <span>{theme === 'light' ? 'Dark theme' : 'Light theme'}</span>
          </button>
          <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); onManage(); }}>
            <ChannelsIcon /><span>Manage channels</span>
          </button>
          <div className="acct-sep" />
          <button role="menuitem" className="acct-item danger" onClick={() => { setOpen(false); onSignOut(); }}>
            <SignOutIcon /><span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function ModesNav() {
  const { mode, selectMode } = useNav();
  const { badge } = useData();
  const items = MODES.map((m) => ({
    id: m.id,
    label: (
      <>
        {m.label}
        {m.id === 'records' && badge.count > 0 && (
          <span className="mode-badge urgent" title={`${badge.count} high-priority to reconcile`}>
            {badge.count > 99 ? '99+' : badge.count}
          </span>
        )}
      </>
    )
  }));
  return <PillNav className="modes" size="mode" ariaLabel="Section" items={items} value={mode} onChange={selectMode} />;
}

export function RangeBar() {
  const { mode, tab, active, range, setPreset, setCustomRange, venue, setVenue } = useNav();
  const { channelList } = useData();

  if (mode === 'home') return null;
  const isSync = tab === 'review';

  if (isSync) {
    return (
      <div className="rangebar">
        <span className="range-note">Sync compares your Sandpiper inventory against the Quail register, joined on inventory number, and lists everything that disagrees.</span>
      </div>
    );
  }

  const showScope = (channelList.booths.length + channelList.stores.length) >= 2;
  const toInput = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const fromInput = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

  return (
    <div className="rangebar">
      <div className="chips">
        {active.presets.map(([k, label]) => (
          <button key={k} className={`chip ${range.preset === k ? 'active' : ''}`} onClick={() => setPreset(k)}>{label}</button>
        ))}
      </div>
      {showScope && (
        <Select className="venue-sel" ariaLabel="Channel scope"
          value={venue.kind === 'all' ? 'all' : `${venue.kind}:${venue.id}`}
          onChange={(v) => setVenue(v === 'all' ? { kind: 'all', id: null } : { kind: v.slice(0, v.indexOf(':')), id: v.slice(v.indexOf(':') + 1) })}
          options={[
            { value: 'all', label: 'All channels' },
            ...(channelList.booths.length ? [{ label: 'Booths', options: channelList.booths.map((b) => ({ value: `booth:${b.id}`, label: `${b.label}${b.type === 'direct' ? ' · direct' : ''}` })) }] : []),
            ...(channelList.stores.length ? [{ label: 'Stores', options: channelList.stores.map((s) => ({ value: `store:${s.id}`, label: `${s.label}${s.type === 'direct' ? ' · direct' : ''}` })) }] : [])
          ]} />
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
  const items = active.tabs.map(([id, label]) => ({
    id,
    label: <>{label}{id === 'review' && <SeverityPills sev={badge.sev} />}</>
  }));
  return <PillNav className="tabs" size="tab" ariaLabel="View" items={items} value={tab} onChange={selectTab} />;
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
const ChannelsIcon = () => <svg viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M3 8h18l-1.2 3.2a2 2 0 0 1-3.8-.7 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-3.8.7L3 8zM5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const MenuIcon = () => <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="19" r="1.7" fill="currentColor" /></svg>;
const RefreshIcon = () => <svg className="spin-target" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
