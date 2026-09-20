import { useMemo, useState } from 'react';
import { useData } from '../store/data.jsx';
import { useNav } from '../store/nav.jsx';
import { money, dateTime } from '../lib/format.js';
import { Card, SearchInput, Select } from '../components/ui.jsx';
import { SortableTable } from '../components/SortableTable.jsx';

/** Sales scoped to the selected booth (by its Quail external id), if any. */
function scopeQuail(quailSales, venue, venueInfo) {
  if (venue.kind !== 'booth' || !venue.id) return quailSales;
  const info = venueInfo.booths && venueInfo.booths[venue.id];
  const ext = info && info.externalId != null ? info.externalId : null;
  return ext == null ? quailSales : quailSales.filter((s) => s.boothId === ext);
}

// Identity first (#, description), then when, then the money ladder, then how it
// was paid — the same left-to-right logic as the Inventory table.
const COLUMNS = [
  { key: 'inv', title: '#', render: (r) => r.inv || '—' },
  { key: 'desc', title: 'Description', cls: 'name', render: (r) => r.desc },
  { key: 'soldAt', title: 'When', render: (r) => dateTime(r.soldAt) },
  { key: 'price', title: 'Price', num: true, render: (r) => money(r.price, { compact: true }) },
  { key: 'tax', title: 'Tax', num: true, render: (r) => money(r.tax, { compact: true }) },
  { key: 'consignment', title: 'Commission', num: true, render: (r) => money(-r.consignment, { compact: true }) },
  { key: 'net', title: 'Net payout', num: true, render: (r) => money(r.net, { compact: true }) },
  { key: 'method', title: 'Paid', render: (r) => r.method },
  { key: 'transactionId', title: 'Txn', num: true, render: (r) => (r.transactionId == null ? '—' : String(r.transactionId)) }
];

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
    return r;
  }, [quailSales, venue, venueInfo, range, method, search]);

  return (
    <Card className="records-card">
      <div className="card-head">
        <h2>Point-of-sale ledger</h2>
        <span className="hint source">Quail register, as the register rang it</span>
        <div className="table-controls">
          <SearchInput placeholder="Search description or #…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="all">All payments</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </div>
      </div>

      {!quailSales.length ? (
        <div className="note">{meta && meta.quailError
          ? `No point-of-sale data: ${meta.quailError}`
          : 'No point-of-sale data yet. Sign in at vendor.quailhq.com, then fetch again.'}</div>
      ) : (
        <div className="table-scroll">
          <SortableTable columns={COLUMNS} rows={rows} initialSort={{ key: 'soldAt', dir: -1 }}
            limit={500} empty="No register sales in this range" />
        </div>
      )}
    </Card>
  );
}
