import { useMemo, useState } from 'react';
import { useData } from '../store/data.jsx';
import { useNav } from '../store/nav.jsx';
import { money, dateTime } from '../lib/format.js';
import { useIsMobile } from '../hooks/useMediaQuery.js';
import { RecordsCard, FilterPill, SearchPill } from '../components/RecordsCard.jsx';
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
  const isMobile = useIsMobile();
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
    <RecordsCard
      filters={
        <FilterPill value={method} ariaLabel="Filter by payment method" onChange={setMethod}
          options={[{ value: 'all', label: 'All payments' }, ...methods.map((m) => ({ value: m, label: m }))]} />
      }
      search={<SearchPill placeholder="Search description or #…" value={search} onChange={(e) => setSearch(e.target.value)} />}
    >
      {!quailSales.length ? (
        <div className="note">{meta && meta.quailError
          ? `No point-of-sale data: ${meta.quailError}`
          : 'No point-of-sale data yet. Sign in at vendor.quailhq.com, then fetch again.'}</div>
      ) : isMobile ? (
        <SaleCards rows={rows} />
      ) : (
        <div className="table-scroll">
          <SortableTable columns={COLUMNS} rows={rows} initialSort={{ key: 'soldAt', dir: -1 }}
            limit={500} empty="No register sales in this range" />
        </div>
      )}
    </RecordsCard>
  );
}

/** Mobile: register sales as a read-only card list, newest first. */
function SaleCards({ rows }) {
  if (!rows.length) return <div className="empty-row">No register sales in this range</div>;
  const shown = [...rows].sort((a, b) => b.soldAt - a.soldAt).slice(0, 500);
  return (
    <div className="rec-cards">
      {shown.map((s, i) => (
        <div className="rec-card" key={s.transactionId ?? `${s.inv}-${i}`}>
          <div className="rc-main rc-static">
            <div className="rc-line1">
              <span className="rc-inv">#{s.inv || '—'}</span>
              <span className="rc-title">{s.desc}</span>
            </div>
            <div className="rc-line2">{dateTime(s.soldAt)} · {s.method}</div>
            <div className="rc-figs">
              <span className="rc-fig"><i>Price</i><b>{money(s.price, { compact: true })}</b></span>
              <span className="rc-fig"><i>Tax</i><b>{money(s.tax, { compact: true })}</b></span>
              <span className="rc-fig"><i>Net</i><b>{money(s.net, { compact: true })}</b></span>
            </div>
          </div>
        </div>
      ))}
      {rows.length > shown.length && (
        <div className="empty-row">Showing first {shown.length} of {rows.length}</div>
      )}
    </div>
  );
}
