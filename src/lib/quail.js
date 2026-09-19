/* Quail POS (vendor.quailhq.com) — normalisation and daily analytics.
 *
 * Quail is the point-of-sale system for the stores Sandpiper's inventory sells
 * through. Its timestamps are when a customer actually bought something, unlike
 * Sandpiper's `sold`, which is when the sale was later keyed in.
 *
 * UNITS WARNING: Quail mixes units in the same object. listPrice, salePrice,
 * discountAmount, originalTotal and totalDiscount are DOLLARS (floats), while
 * taxAmount, consignmentAmount and cardFeeAmount are CENTS (ints). Everything is
 * converted to cents here so the rest of the app never has to think about it.
 */

import { DOW_LABELS, dowIndex, sum, median, DAY } from './analytics.js';

const toCents = (dollars) => Math.round((Number(dollars) || 0) * 100);
const cents = (v) => Math.round(Number(v) || 0);

/** "2026-09-03 23:45:58.707+0000" -> epoch ms */
export function parseQuailTime(text) {
  if (!text) return null;
  const iso = String(text).trim().replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Flattens /api/portal/booth-items rows into one record per sold line item. */
export function normalizeQuailSales(rows) {
  return (rows || []).map((row) => {
    const it = row.item || {};
    const payment = (row.payments && row.payments[0]) || {};
    const price = toCents(it.listPrice);
    const consignment = cents(it.consignmentAmount);
    const cardFee = cents(it.cardFeeAmount) || toCents(row.cardFee);
    return {
      id: it.id,
      boothId: it.boothId,
      soldAt: parseQuailTime(it.timestamp),
      inv: (it.inventory || '').trim(),
      desc: (it.description || '').trim() || '(no description)',
      quantity: it.quantity || 1,
      price,
      tax: cents(it.taxAmount),
      total: toCents(it.salePrice),
      discount: toCents(it.discountAmount) || toCents(it.totalDiscount),
      consignment,
      cardFee,
      // What actually reaches the vendor, before booth rent.
      net: price - consignment - cardFee,
      category: (it.category || '').trim(),
      storeName: it.storeName || '',
      boothNumber: it.boothNumber || '',
      transactionId: payment.transactionId != null ? payment.transactionId : null,
      method: payment.method || 'unknown'
    };
  }).filter((s) => s.soldAt != null);
}

export function normalizeBooths(rows) {
  return (rows || []).map((b) => ({
    boothId: b.boothId,
    storeId: b.storeId,
    boothNumber: b.boothNumber || '',
    storeName: b.storeName || '',
    consignmentRate: (Number(b.consignmentRate) || 0) / 100,
    cardRate: (Number(b.cardRate) || 0) / 100,
    rent: cents(b.rent),
    closedOn: b.closedOn || null
  }));
}

/* ------------------------------------------------------------ aggregation */

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Daily/rhythm analytics over real POS timestamps.
 * `rentCents` is the booth rent attributable to the range, which Sandpiper knows
 * nothing about — without it "profit" is overstated by a fixed monthly cost.
 */
export function analyzeQuail(sales, { start, end, rentCents = 0 } = {}) {
  const inRange = sales.filter((s) => s.soldAt >= start && s.soldAt <= end);

  const gross = sum(inRange, (s) => s.price);
  const consignment = sum(inRange, (s) => s.consignment);
  const cardFees = sum(inRange, (s) => s.cardFee);
  const net = gross - consignment - cardFees;

  // Daily series across every day in the window, including zero days — the gaps
  // are the point of a daily view.
  const byDay = new Map();
  for (const s of inRange) {
    const k = dayKey(s.soldAt);
    if (!byDay.has(k)) byDay.set(k, { key: k, t: new Date(s.soldAt).setHours(0, 0, 0, 0), units: 0, gross: 0, net: 0, transactions: new Set() });
    const d = byDay.get(k);
    d.units += 1;
    d.gross += s.price;
    d.net += s.net;
    if (s.transactionId != null) d.transactions.add(s.transactionId);
  }
  const days = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  let guard = 0;
  while (cursor.getTime() <= end && guard++ < 1500) {
    const k = dayKey(cursor.getTime());
    const hit = byDay.get(k);
    days.push({
      key: k,
      t: cursor.getTime(),
      label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      units: hit ? hit.units : 0,
      gross: hit ? hit.gross : 0,
      net: hit ? hit.net : 0,
      transactions: hit ? hit.transactions.size : 0
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const activeDays = days.filter((d) => d.units > 0);
  const dayOfWeek = DOW_LABELS.map((label, idx) => {
    const rows = inRange.filter((s) => dowIndex(s.soldAt) === idx);
    // Average per occurrence of that weekday, so a partial range can't mislead.
    const occurrences = days.filter((d) => dowIndex(d.t) === idx).length || 1;
    return {
      label,
      units: rows.length,
      gross: sum(rows, (s) => s.price),
      net: sum(rows, (s) => s.net),
      occurrences,
      avgGross: sum(rows, (s) => s.price) / occurrences,
      avgUnits: rows.length / occurrences
    };
  });

  const hours = Array.from({ length: 24 }, (_, h) => {
    const rows = inRange.filter((s) => new Date(s.soldAt).getHours() === h);
    return { hour: h, label: `${(h % 12) || 12}${h < 12 ? 'a' : 'p'}`, units: rows.length, gross: sum(rows, (s) => s.price) };
  });

  const txns = new Map();
  for (const s of inRange) {
    const key = s.transactionId != null ? s.transactionId : `solo-${s.id}`;
    if (!txns.has(key)) txns.set(key, []);
    txns.get(key).push(s);
  }
  const baskets = [...txns.values()];

  const methods = new Map();
  for (const t of baskets) {
    const m = t[0].method || 'unknown';
    if (!methods.has(m)) methods.set(m, { method: m, transactions: 0, units: 0, gross: 0 });
    const entry = methods.get(m);
    entry.transactions += 1;
    entry.units += t.length;
    entry.gross += sum(t, (s) => s.price);
  }

  return {
    range: { start, end },
    units: inRange.length,
    gross,
    consignment,
    cardFees,
    tax: sum(inRange, (s) => s.tax),
    discounts: sum(inRange, (s) => s.discount),
    net,
    rent: rentCents,
    // The number Sandpiper can't produce: takings after commission AND rent.
    netAfterRent: net - rentCents,
    rentCoverage: rentCents > 0 ? net / rentCents : null,
    days,
    activeDays: activeDays.length,
    totalDays: days.length,
    bestDay: activeDays.reduce((a, b) => (!a || b.gross > a.gross ? b : a), null),
    avgPerActiveDay: activeDays.length ? gross / activeDays.length : 0,
    medianPerActiveDay: median(activeDays.map((d) => d.gross)),
    dayOfWeek,
    bestWeekday: dayOfWeek.reduce((a, b) => (!a || b.avgGross > a.avgGross ? b : a), null),
    hours,
    transactions: baskets.length,
    avgBasketUnits: baskets.length ? inRange.length / baskets.length : 0,
    avgBasketValue: baskets.length ? gross / baskets.length : 0,
    multiItemRate: baskets.length ? baskets.filter((b) => b.length > 1).length / baskets.length : 0,
    methods: [...methods.values()].sort((a, b) => b.gross - a.gross),
    recent: [...inRange].sort((a, b) => b.soldAt - a.soldAt).slice(0, 12),
    lastSaleAt: inRange.length ? Math.max(...inRange.map((s) => s.soldAt)) : null,
    daysSinceLastSale: inRange.length ? (Date.now() - Math.max(...inRange.map((s) => s.soldAt))) / DAY : null
  };
}
