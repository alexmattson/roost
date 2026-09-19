import { useMemo, useState } from 'react';
import { useData } from '../store/data.jsx';
import { useNav } from '../store/nav.jsx';
import { analyze, dataBounds } from '../lib/analytics.js';
import { rentForRange } from '../lib/ledger.js';
import { reconcile } from '../lib/reconcile.js';
import { planResolution, buildVenueContext } from '../lib/resolve.js';
import { money, int, timeAgo } from '../lib/format.js';
import { format as fmtDate } from 'date-fns';
import { Card, Button } from '../components/ui.jsx';

const bandSign = (v) => (v == null || !isFinite(v) ? 'good' : v >= 0 ? 'good' : 'alert');

/** Playful, time-of-day greeting — steady through the day, different tomorrow. */
function homeGreeting(now) {
  const h = now.getHours();
  const bucket = h < 12
    ? ['Rise and resell ☀️', 'Morning — let’s go treasure hunting', 'Coffee’s brewing, so are the numbers', 'Top of the morning, picker']
    : h < 17
      ? ['Afternoon — anything good move today?', 'Back at the booth', 'How’s the hustle going?', 'Mid-day check-in ✨']
      : h < 22
        ? ['Evening — let’s tally the wins', 'Closing-time numbers', 'Good evening, treasure hunter', 'Another day, another find']
        : ['Burning the midnight oil? 🌙', 'The booth never sleeps', 'Late-night bookkeeping, respect'];
  const seed = now.getFullYear() * 366 + (now.getMonth() * 31 + now.getDate());
  return bucket[seed % bucket.length];
}

export function Home() {
  const { ledger, items, quailSales, ledgerSummary, venueInfo, applyEdits, raw } = useData();
  const { selectMode, selectTab, goToInventory, goToSync, setInventoryFilter } = useNav();
  const [banner, setBanner] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const quailRent = (raw.quail && raw.quail.rent) || [];
  const now = new Date();
  const stats = useMemo(() => {
    const b = dataBounds(ledger.length ? ledger : items);
    return analyze(ledger, { start: b.min, end: Math.max(Date.now(), b.max) });
  }, [ledger, items]);

  const takeHome = (start, end) =>
    analyze(ledger, { start, end }).sales.net - rentForRange(quailRent, start, end).cents;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const thisMonth = takeHome(monthStart, now.getTime());
  const lastMonth = takeHome(lastStart, monthStart - 1);
  const monthName = fmtDate(now, 'MMMM');
  const lastName = fmtDate(lastStart, 'MMMM');

  const newSales = useMemo(() => {
    if (!quailSales.length) return [];
    const ctx = buildVenueContext(venueInfo);
    const b = dataBounds(ledger.length ? ledger : items);
    const r = reconcile(items, quailSales, { start: b.min, end: Math.max(Date.now(), b.max) });
    return r.findings
      .filter((f) => f.type === 'sold-in-quail-not-in-sandpiper')
      .map((f) => ({ finding: f, plan: planResolution(f, ctx) }))
      .filter((e) => e.plan);
  }, [items, quailSales, ledger, venueInfo]);

  const attention = useMemo(() => {
    const out = [];
    const add = (tone, text, cta, to) => { if (to) out.push({ tone, text, cta, to }); };
    add('warn', <><b>{int(stats.counts.unpriced)}</b> unsold items have no asking price</>,
      'Add prices', stats.counts.unpriced ? { filter: 'noprice' } : null);
    add('warn', <><b>{int(stats.counts.zeroCost)}</b> unsold items recorded at $0 cost</>,
      'Set costs', stats.counts.zeroCost ? { filter: 'zerocost' } : null);
    add(stats.inventory.stale > stats.inventory.units * 0.3 ? 'bad' : 'warn',
      <><b>{int(stats.inventory.stale)}</b> items held over 180 days</>,
      money(stats.inventory.staleCost, { compact: true }), stats.inventory.stale ? { filter: 'aged' } : null);
    if (ledgerSummary && ledgerSummary.costUnknown) {
      add('warn', <><b>{int(ledgerSummary.costUnknown)}</b> register sales aren’t in Sandpiper yet</>,
        'Review', { sync: true });
    }
    return out;
  }, [stats, ledgerSummary]);

  const recent = useMemo(
    () => ledger.filter((i) => i.isSold && i.sold).sort((a, b) => b.sold - a.sold).slice(0, 5),
    [ledger]
  );

  const goTo = (to) => {
    if (to.sync) return goToSync();
    if (to.filter) return goToInventory(to.filter);
  };

  const doSync = async () => {
    setSyncing(true);
    try {
      const res = await applyEdits(newSales.map((e) => ({
        itemId: e.plan.itemId,
        changes: e.plan.changes.map((c) => ({ field: c.field, to: c.to }))
      })));
      const failed = res.results.filter((r) => !r.ok);
      setBanner({ kind: failed.length ? 'error' : 'ok',
        text: failed.length ? `Synced ${int(res.applied)} of ${int(newSales.length)} — ${failed[0].error}`
                             : `Recorded ${int(res.applied)} sale${res.applied === 1 ? '' : 's'} in Sandpiper.` });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message || String(e) });
    } finally { setSyncing(false); }
  };

  const heroStatus = bandSign(thisMonth);

  return (
    <div className="home">
      <Card className="home-hero">
        <div className="home-greet">{homeGreeting(now)}</div>
        <div className="home-take-num">{money(thisMonth)}</div>
        <div className="home-take-sub">taken home in {monthName}, so far</div>
        <div className="home-lastmonth">{lastName}&nbsp;&nbsp;<b>{money(lastMonth)}</b></div>
        <div className="home-actions">
          <Button variant="primary" onClick={() => { setInventoryFilter('nobarcode'); goToInventory('all'); }}>+ Add stock</Button>
          {stats.inventory.stale > 0 &&
            <Button onClick={() => goToInventory('aged')}>Reprice slow stock ({int(stats.inventory.stale)})</Button>}
          <Button variant="ghost" onClick={() => selectMode('analyze')}>See full analytics →</Button>
        </div>
      </Card>

      {newSales.length > 0 && (
        <div className="home-sync">
          <div className="home-sync-burst">✦</div>
          <div className="home-sync-body">
            <div className="home-sync-num">{int(newSales.length)} new sale{newSales.length === 1 ? '' : 's'}</div>
            <div className="home-sync-sub">
              worth <b>{money(newSales.reduce((a, e) => a + (e.finding.quail ? e.finding.quail.price : 0), 0))}</b>,
              caught by the register. Sync to record {newSales.length === 1 ? 'it' : 'them'} in Sandpiper.
            </div>
          </div>
          <button className="home-sync-go" onClick={doSync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        </div>
      )}

      {banner && <div className={`banner ${banner.kind}`}><span>{banner.text}</span></div>}

      <div className="home-cols">
        <Card className="home-card">
          <div className="card-head"><h2>Needs attention</h2></div>
          <div id="home-attention">
            {attention.length === 0
              ? <div className="home-clear"><span className="home-check">✓</span> All caught up — nothing needs attention.</div>
              : attention.map((r, i) => (
                  <button className="home-item" key={i} onClick={() => goTo(r.to)}>
                    <span className={`home-dot is-${r.tone}`} />
                    <span className="home-item-body">
                      <span className="home-item-text">{r.text}</span>
                      <span className="home-item-cta">{r.cta}</span>
                    </span>
                  </button>
                ))}
          </div>
        </Card>

        <Card className="home-card">
          <div className="card-head"><h2>Recent sales</h2><span className="hint">Newest first</span></div>
          <div id="home-recent">
            {recent.length === 0
              ? <div className="home-empty">No sales recorded yet.</div>
              : (<>
                  {recent.map((r) => (
                    <div className="home-sale" key={r.id}>
                      <span className="home-sale-desc">{r.desc}</span>
                      <span className="home-sale-price">{money(r.soldPrice)}</span>
                      <span className="home-sale-when">{timeAgo(r.sold)}</span>
                    </div>
                  ))}
                  <button className="home-more" onClick={() => { selectMode('records'); selectTab('pos'); }}>See all sales →</button>
                </>)}
          </div>
        </Card>
      </div>
    </div>
  );
}
