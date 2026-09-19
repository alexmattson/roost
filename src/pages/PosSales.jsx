import { useMemo, useState } from 'react';
import { useData } from '../store/data.jsx';
import { useNav } from '../store/nav.jsx';
import { money, dateTime } from '../lib/format.js';
import { Card } from '../components/ui.jsx';


/** Sales scoped to the selected booth (by its Quail external id), if any. */
function scopeQuail(quailSales, venue, venueInfo) {
  if (venue.kind !== 'booth' || !venue.id) return quailSales;
  const info = venueInfo.booths && venueInfo.booths[venue.id];
  const ext = info && info.externalId != null ? info.externalId : null;
  return ext == null ? quailSales : quailSales.filter((s) => s.boothId === ext);
}

export function PosSales() {
  const { quailSales, venueInfo, meta } = useData();
  const { range, venue } = useNav();
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('all');

  const methods = useMemo(() => [...new Set(quailSales.map((s) => s.method))].sort(), [quailSales]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = scopeQuail(quailSales, venue, venueInfo).filter((s) => s.soldAt >= range.start && s.soldAt <= range.end);
    if (method !== 'all') r = r.filter((s) => s.method === method);
    if (q) r = r.filter((s) => s.desc.toLowerCase().includes(q) || String(s.inv).toLowerCase().includes(q));
    return r.sort((a, b) => b.soldAt - a.soldAt);
  }, [quailSales, venue, venueInfo, range, method, search]);

  const shown = rows.slice(0, 500);

  return (
    <Card className="records-card">
      <div className="card-head">
        <h2>Point-of-sale ledger</h2>
        <span className="hint source">Quail register, as the register rang it</span>
        <div className="table-controls">
          <input type="search" placeholder="Search description or #…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="all">All payments</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {!quailSales.length ? (
        <div className="note">{meta && meta.quailError
          ? `No point-of-sale data: ${meta.quailError}`
          : 'No point-of-sale data yet. Sign in at vendor.quailhq.com, then fetch again.'}</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr>
              <th>When</th><th>#</th><th>Item</th>
              <th className="num">Price</th><th className="num">Tax</th><th className="num">Commission</th>
              <th className="num">Net payout</th><th>Paid</th><th className="num">Txn</th>
            </tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={9}><div className="empty-row">No register sales in this range</div></td></tr>}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>{dateTime(r.soldAt)}</td>
                  <td>{r.inv || '—'}</td>
                  <td className="name">{r.desc}</td>
                  <td className="num">{money(r.price, { compact: true })}</td>
                  <td className="num">{money(r.tax, { compact: true })}</td>
                  <td className="num">{money(-r.consignment, { compact: true })}</td>
                  <td className="num">{money(r.net, { compact: true })}</td>
                  <td>{r.method}</td>
                  <td className="num">{r.transactionId == null ? '—' : String(r.transactionId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown.length && <div className="empty-row">Showing first {shown.length} of {rows.length}</div>}
        </div>
      )}
    </Card>
  );
}
