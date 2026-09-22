import { useMemo, useState } from 'react';
import { useData } from '../store/data.jsx';
import { dataBounds } from '../lib/analytics.js';
import { reconcile } from '../lib/reconcile.js';
import { planResolution, planPin, PINNABLE_TYPES, buildVenueContext, CONFIDENCE } from '../lib/resolve.js';
import { FINDING_LABELS, findingKey, matchOf } from '../lib/reconcile-ui.js';
import { dayMonth } from '../lib/format.js';
import { Card } from '../components/ui.jsx';
import { RecordsCard, FilterPill } from '../components/RecordsCard.jsx';
import { useIsMobile } from '../hooks/useMediaQuery.js';
import { useToast } from '../store/toast.jsx';

export function Sync() {
  const { items, quailSales, venueInfo, applyEdits } = useData();
  const toast = useToast();
  const isMobile = useIsMobile();
  const [filters, setFilters] = useState({ severity: 'all', match: 'all', type: 'all' });
  const [selected, setSelected] = useState(() => new Set());
  const [pending, setPending] = useState(null); // { entries } awaiting confirm
  const [applying, setApplying] = useState(false);

  const entries = useMemo(() => {
    if (!quailSales.length) return [];
    const ctx = buildVenueContext(venueInfo);
    const b = dataBounds(items);
    const r = reconcile(items, quailSales, { start: b.min, end: Math.max(Date.now(), b.max) });
    return r.findings.map((f, i) => ({
      key: findingKey(f, i), finding: f,
      // Probable untagged matches resolve by pinning the link into notes (and
      // aligning any values), so the pairing sticks; the rest correct values.
      plan: PINNABLE_TYPES.includes(f.type) ? planPin(f, ctx) : planResolution(f, ctx)
    }));
  }, [items, quailSales, venueInfo]);

  const types = useMemo(() => {
    const present = [...new Set(entries.map((e) => e.finding.type))];
    present.sort((a, b) => (FINDING_LABELS[a] || a).localeCompare(FINDING_LABELS[b] || b));
    return present;
  }, [entries]);

  const visible = useMemo(() => entries.filter((e) =>
    (filters.severity === 'all' || e.finding.severity === filters.severity)
    && (filters.match === 'all' || matchOf(e) === filters.match)
    && (filters.type === 'all' || e.finding.type === filters.type)
  ), [entries, filters]);

  const pickable = visible.filter((e) => e.plan);
  const visibleKeys = new Set(visible.map((e) => e.key));
  const chosen = pickable.filter((e) => selected.has(e.key) && visibleKeys.has(e.key));
  const allPicked = pickable.length > 0 && pickable.every((e) => selected.has(e.key));

  if (!quailSales.length) {
    return <Card><div className="empty-row">Sign in at vendor.quailhq.com and fetch again to reconcile.</div></Card>;
  }

  const toggle = (key, on) => setSelected((prev) => {
    const next = new Set(prev);
    if (on) next.add(key); else next.delete(key);
    return next;
  });
  const toggleAll = (on) => setSelected((prev) => {
    const next = new Set(prev);
    for (const e of pickable) { if (on) next.add(e.key); else next.delete(e.key); }
    return next;
  });

  const apply = async (list) => {
    setApplying(true);
    try {
      const res = await applyEdits(list.map((e) => ({
        itemId: e.plan.itemId,
        changes: e.plan.changes.map((c) => ({ field: c.field, to: c.to }))
      })));
      setSelected(new Set());
      setPending(null);
      const bad = res.results && res.results.find((r) => !r.ok);
      if (bad) toast('error', `Resolved some, then stopped: ${bad.error}`, 0);
      else toast('ok', `Resolved ${list.length} finding${list.length === 1 ? '' : 's'} in Sandpiper.`);
    } catch (e) {
      toast('error', e.message || String(e), 0);
    } finally {
      setApplying(false);
    }
  };

  return (
    <RecordsCard
      filters={<>
        <FilterPill value={filters.severity} ariaLabel="Filter by severity"
          onChange={(v) => setFilters({ ...filters, severity: v })}
          options={[{ value: 'all', label: 'All severities' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} />
        <FilterPill value={filters.match} ariaLabel="Filter by match confidence"
          onChange={(v) => setFilters({ ...filters, match: v })}
          options={[{ value: 'all', label: 'All matches' }, { value: 'exact', label: 'Exact only' }, { value: 'probable', label: 'Probable only' }, { value: 'manual', label: 'Manual only' }]} />
        <FilterPill value={types.includes(filters.type) ? filters.type : 'all'} ariaLabel="Filter by finding type"
          onChange={(v) => setFilters({ ...filters, type: v })}
          options={[{ value: 'all', label: 'All kinds' }, ...types.map((t) => ({ value: t, label: FINDING_LABELS[t] || t }))]} />
      </>}
    >
      <FixBar
        pickable={pickable} chosen={chosen} pending={pending} applying={applying}
        totalShown={visible.length} total={entries.length}
        onClear={() => setSelected(new Set())}
        onResolve={() => setPending({ entries: chosen })}
        onCancel={() => setPending(null)}
        onApply={() => apply(pending.entries)}
      />

      {isMobile ? (
        <FindingCards visible={visible} entries={entries} selected={selected} applying={applying}
          onToggle={toggle} onFix={(e) => apply([e])} />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="pick">
                  <input type="checkbox" checked={allPicked} disabled={!pickable.length}
                    ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && !allPicked; }}
                    onChange={(e) => toggleAll(e.target.checked)} title="Select every fixable row in view" />
                </th>
                <th>Match</th><th>Severity</th><th>What</th><th>When</th><th>Detail</th><th className="act" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={7}><div className="empty-row">{entries.length ? 'No anomalies match these filters.' : 'No anomalies — the two systems agree.'}</div></td></tr>
              )}
              {visible.map((e) => {
                const m = matchOf(e);
                return (
                  <tr key={e.key}>
                    <td className="pick">{e.plan && (
                      <input type="checkbox" checked={selected.has(e.key)} onChange={(ev) => toggle(e.key, ev.target.checked)} />
                    )}</td>
                    <td><span className={`pill ${m}`} data-match={m}>{m}</span></td>
                    <td><span className={`pill ${e.finding.severity}`}>{e.finding.severity}</span></td>
                    <td>{FINDING_LABELS[e.finding.type] || e.finding.type}</td>
                    <td>{e.finding.soldAt ? dayMonth(e.finding.soldAt) : "—"}</td>
                    <td className="wrap">
                      <div className="finding-detail">{e.finding.detail}</div>
                      {e.plan
                        ? <div className="finding-note">Fix: {e.plan.summary}</div>
                        : (e.finding.note && <div className="finding-note">{e.finding.note}</div>)}
                    </td>
                    <td className="act">{e.plan && (
                      <button className="fix-btn" disabled={applying} onClick={() => apply([e])}>Fix</button>
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </RecordsCard>
  );
}

/** Mobile: each reconcile finding as a card, with its Fix action inline. */
function FindingCards({ visible, entries, selected, applying, onToggle, onFix }) {
  if (visible.length === 0) {
    return <div className="empty-row">{entries.length ? 'No anomalies match these filters.' : 'No anomalies — the two systems agree.'}</div>;
  }
  return (
    <div className="rec-cards">
      {visible.map((e) => {
        const m = matchOf(e);
        return (
          <div className="rec-card" key={e.key}>
            {e.plan && (
              <label className="rc-check" onClick={(ev) => ev.stopPropagation()}>
                <input type="checkbox" checked={selected.has(e.key)} onChange={(ev) => onToggle(e.key, ev.target.checked)} aria-label="Select finding" />
              </label>
            )}
            <div className="rc-main rc-static">
              <div className="rc-badges">
                <span className={`pill ${m}`} data-match={m}>{m}</span>
                <span className={`pill ${e.finding.severity}`}>{e.finding.severity}</span>
                {e.finding.soldAt && <span className="rc-when">{dayMonth(e.finding.soldAt)}</span>}
              </div>
              <div className="rc-title">{FINDING_LABELS[e.finding.type] || e.finding.type}</div>
              <div className="finding-detail">{e.finding.detail}</div>
              {e.plan
                ? <div className="finding-note">Fix: {e.plan.summary}</div>
                : (e.finding.note && <div className="finding-note">{e.finding.note}</div>)}
            </div>
            {e.plan && (
              <div className="rc-actions">
                <button className="fix-btn" disabled={applying} onClick={() => onFix(e)}>Fix</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FixBar({ pickable, chosen, pending, applying, totalShown, total, onClear, onResolve, onCancel, onApply }) {
  if (!total) return null;

  if (pending) {
    const probable = pending.entries.filter((e) => e.plan.confidence === CONFIDENCE.probable).length;
    return (
      <div className="fix-bar confirm">
        <div className="confirm-head">Resolve selected: {pending.entries.length} item{pending.entries.length === 1 ? '' : 's'} will be updated in Sandpiper</div>
        <div className="confirm-list">
          {pending.entries.map((e) => (
            <div className="confirm-row" key={e.key}>
              <span className="inv">{e.plan.inv || '—'}</span>
              <span>{e.plan.changes.map((c, i) => (
                <span key={i}>{i > 0 && ' · '}
                  <span className="confirm-change">{c.label} <b>{c.displayFrom == null ? '—' : String(c.displayFrom)}</b> → <b>{c.display}</b></span>
                </span>
              ))}</span>
            </div>
          ))}
        </div>
        <div className="confirm-actions">
          <span className="confirm-warn">{probable ? `${probable} of these rest on a probable match, not an exact one.` : ''}</span>
          <button className="fix-btn" onClick={onCancel}>Cancel</button>
          <button className="fix-btn primary" onClick={onApply} disabled={applying}>
            {applying ? 'Applying…' : `Apply ${pending.entries.length} edit${pending.entries.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    );
  }

  const filtered = totalShown < total;
  return (
    <div className="fix-bar">
      <span className="count"><b>{pickable.length}</b> fixable{filtered ? ' in view' : ''} · <b>{chosen.length}</b> selected</span>
      <button className="fix-btn link" disabled={!chosen.length} onClick={onClear}>Clear</button>
      <button className="fix-btn primary" disabled={!chosen.length} onClick={onResolve}>Resolve selected{chosen.length ? ` (${chosen.length})` : ''}</button>
    </div>
  );
}
