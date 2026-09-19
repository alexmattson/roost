import { DAY } from './analytics.js';
import { money, int, pct } from './format.js';
import { days, signClass, shortDate } from './format.js';

export const dateInputValue = (t) => {
  if (!t) return '';
  const d = new Date(t);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const unixFromDateInput = (v) => (v ? Math.floor(new Date(`${v}T12:00:00`).getTime() / 1000) : null);
export const centsFromText = (v) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
export const centsToText = (v) => (v == null ? '' : (v / 100).toFixed(2));

/** Column definitions — same widths and renders as the vanilla table. */
export const ITEM_COLUMNS = [
  { key: 'inv', title: '#', w: 7, render: (r) => r.inv || '—' },
  { key: 'desc', title: 'Description', w: 17, cls: 'name', render: (r) => r.desc },
  { key: 'category', title: 'Category', w: 9, render: (r) => r.category },
  { key: 'acquired', title: 'Acquired', w: 11, num: true, render: (r) => (r.acquired ? shortDate(r.acquired) : '—') },
  { key: 'cost', title: 'Cost', w: 7, num: true, render: (r) => money(r.cost, { compact: true }) },
  { key: 'ask', title: 'Ask', w: 7, num: true, render: (r) => (r.ask ? money(r.ask, { compact: true }) : '—') },
  { key: 'sold', title: 'Sold on', w: 11, num: true, render: (r) => (r.sold ? shortDate(r.sold) : '—') },
  { key: 'soldPrice', title: 'Sold for', w: 7, num: true, render: (r) => (r.isSold ? money(r.soldPrice, { compact: true }) : null) },
  { key: 'profit', title: 'Profit', w: 7, num: true, cls: (r) => signClass(r.profit || 0), render: (r) => (r.profit == null ? '—' : money(r.profit, { compact: true })) },
  { key: 'margin', title: 'Margin', w: 5, num: true, render: (r) => (r.margin == null ? '—' : pct(r.margin, 0)) },
  { key: 'daysToSell', title: 'Days', w: 5, num: true, render: (r) => days(r.daysToSell) }
];
export const ITEM_ACTS_W = 7;

/** Filters the raw Sandpiper items for the Inventory table, in-range and by kind. */
export function filterItems(items, { start, end, filter, search }) {
  const heldAtEnd = (i) => i.acquired != null && i.acquired <= end && (i.sold == null || i.sold > end);
  const ageAtEnd = (i) => (i.acquired != null ? (end - i.acquired) / DAY : null);

  let rows = items.filter((i) => {
    const acq = i.acquired == null || (i.acquired >= start && i.acquired <= end);
    const sld = i.sold != null && i.sold >= start && i.sold <= end;
    const held = heldAtEnd(i);
    return acq || sld || held;
  });

  if (filter === 'onhand') rows = rows.filter(heldAtEnd);
  else if (filter === 'sold') rows = rows.filter((i) => i.isSold);
  else if (filter === 'loss') rows = rows.filter((i) => i.isSold && i.profit < 0);
  else if (filter === 'noprice') rows = rows.filter((i) => heldAtEnd(i) && i.ask <= 0);
  else if (filter === 'zerocost') rows = rows.filter((i) => heldAtEnd(i) && i.cost <= 0);
  else if (filter === 'aged') rows = rows.filter((i) => heldAtEnd(i) && (ageAtEnd(i) || 0) > 180);
  else if (filter === 'nobarcode') rows = rows.filter((i) => heldAtEnd(i) && !i.hasBarcode);

  const q = (search || '').trim().toLowerCase();
  if (q) rows = rows.filter((i) => i.desc.toLowerCase().includes(q) || String(i.inv).toLowerCase().includes(q));
  return rows;
}

export function sortItems(rows, { key, dir }) {
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
}

/** The smallest set of changes an edited row implies, in the API's units. */
export function collectChanges(r, fields) {
  const changes = [];
  const inv = String(fields.inv || '').trim();
  if (inv !== r.inv) changes.push({ field: 'inventoryNumber', to: inv });

  const desc = String(fields.desc || '').trim();
  const was = r.desc === '(no description)' ? '' : r.desc;
  if (desc !== was) changes.push({ field: 'description', to: desc });

  const acq = unixFromDateInput(fields.acquired);
  if (acq !== (r.acquired == null ? null : Math.round(r.acquired / 1000))) changes.push({ field: 'acquired', to: acq || 0 });

  const cost = centsFromText(fields.cost);
  if (cost != null && cost !== r.cost) {
    changes.push({ field: 'originalCost', to: cost });
    changes.push({ field: 'totalCost', to: cost + (r.restoration || 0) });
  }

  const ask = centsFromText(fields.ask);
  if (ask != null && ask !== r.ask) changes.push({ field: 'askingPrice', to: ask });

  if (r.isSold) {
    const sold = unixFromDateInput(fields.sold);
    if (sold && sold !== Math.round(r.sold / 1000)) changes.push({ field: 'sold', to: sold });
    const sp = centsFromText(fields.soldPrice);
    if (sp != null && sp !== r.soldPrice) changes.push({ field: 'soldPrice', to: sp });
  }
  return changes;
}

export const editFields = (r) => ({
  inv: r.inv,
  desc: r.desc === '(no description)' ? '' : r.desc,
  acquired: dateInputValue(r.acquired),
  cost: centsToText(r.cost),
  ask: centsToText(r.ask),
  sold: dateInputValue(r.sold),
  soldPrice: centsToText(r.soldPrice)
});
