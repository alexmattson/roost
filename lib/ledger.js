/* One reconciled view of what sold, for every figure in the dashboard to read.
 *
 * Sandpiper and Quail each know things the other does not, so neither is a
 * complete account on its own:
 *   - Quail is the register. It knows what was actually charged, what commission
 *     came off, and when the customer bought.
 *   - Sandpiper knows what the stock cost, which the register never sees.
 *
 * buildLedger overlays register truth onto the inventory records and adds any
 * sale the register saw that Sandpiper has not recorded yet, so every tab counts
 * the same sales at the same values. The raw Sandpiper items are left untouched
 * for the Review tab, whose whole job is to show where the two disagree.
 */

import { DAY } from './analytics.js';

const norm = (inv) => String(inv || '').trim().toLowerCase().replace(/^0+(?=\d)/, '');

export function buildLedger(items, quailSales, ctx = {}) {
  const boothByExternalId = ctx.boothByExternalId || {};
  const storeIdForBooth = ctx.storeIdForBooth || {};

  const byInv = new Map();
  for (const item of items) {
    const key = norm(item.inv);
    if (!key) continue;
    if (!byInv.has(key)) byInv.set(key, []);
    byInv.get(key).push(item);
  }

  const claimed = new Set();
  const overlay = new Map();          // item id -> register values
  const extra = [];                   // sales the register saw, Sandpiper has not
  let corrected = 0;
  let added = 0;
  let paired = 0;
  let costUnknown = 0;

  for (const sale of quailSales) {
    const candidates = (byInv.get(norm(sale.inv)) || []).filter((i) => !claimed.has(i.id));
    // Prefer an item already marked sold, nearest in time to the register entry.
    const sold = candidates.filter((c) => c.sold != null);
    let pick = (sold.length ? sold : candidates)
      .slice()
      .sort((a, b) => Math.abs((a.sold || 0) - sale.soldAt) - Math.abs((b.sold || 0) - sale.soldAt))[0];

    /* A register sale with no inventory tag still has a counterpart in Sandpiper
     * most of the time. Without this the same real sale is counted twice: once as
     * the untagged register row and again as the Sandpiper record it belongs to.
     * Same test the reconciler uses, so the two views agree on what pairs up. */
    if (!pick && !sale.inv) {
      pick = items
        .filter((i) => !claimed.has(i.id) && i.isSold
          && Math.abs(i.soldPrice - sale.price) <= 2
          && Math.abs(i.sold - sale.soldAt) <= 2 * DAY)
        .sort((a, b) => Math.abs(a.sold - sale.soldAt) - Math.abs(b.sold - sale.soldAt))[0];
      if (pick) paired += 1;
    }

    if (!pick) {
      const booth = boothByExternalId[sale.boothId] || null;
      extra.push({
        id: `quail-${sale.id}`,
        inv: sale.inv || '',
        desc: sale.desc,
        category: 'Decor & Other',
        acquired: null,
        sold: sale.soldAt,
        isSold: true,
        cost: 0,
        origCost: 0,
        restoration: 0,
        ask: sale.price,
        soldPrice: sale.price,
        commission: sale.consignment,
        fees: sale.cardFee,
        net: sale.net,
        profit: sale.net,                 // no cost basis to subtract
        margin: sale.price > 0 ? sale.net / sale.price : null,
        markup: null,
        discount: null,
        daysToSell: null,
        store: booth ? storeIdForBooth[booth] || null : null,
        booth,
        notes: '',
        hasBarcode: false,
        source: 'quail',
        costKnown: false
      });
      added += 1;
      costUnknown += 1;
      continue;
    }

    claimed.add(pick.id);
    const booth = boothByExternalId[sale.boothId] || pick.booth || null;
    overlay.set(pick.id, {
      sold: sale.soldAt,
      soldPrice: sale.price,
      commission: sale.consignment,
      fees: sale.cardFee,
      booth,
      store: (booth && storeIdForBooth[booth]) || pick.store || null
    });
    const differs = pick.sold == null
      || pick.soldPrice !== sale.price
      || pick.commission !== sale.consignment
      || pick.fees !== sale.cardFee;
    if (differs) corrected += 1;
  }

  const merged = items.map((item) => {
    const o = overlay.get(item.id);
    if (!o) return { ...item, source: 'sandpiper', costKnown: true };
    const net = o.soldPrice - o.commission - o.fees;
    return {
      ...item,
      sold: o.sold,
      isSold: true,
      soldPrice: o.soldPrice,
      commission: o.commission,
      fees: o.fees,
      booth: o.booth,
      store: o.store,
      net,
      profit: net - item.cost,
      margin: o.soldPrice > 0 ? (net - item.cost) / o.soldPrice : null,
      discount: item.ask > 0 ? 1 - o.soldPrice / item.ask : null,
      daysToSell: item.acquired != null ? Math.max(0, (o.sold - item.acquired) / DAY) : null,
      source: 'both',
      costKnown: true
    };
  });

  return {
    items: merged.concat(extra),
    summary: { corrected, added, paired, costUnknown, matched: claimed.size, quailSales: quailSales.length }
  };
}

/** Booth rent attributable to a window, prorated across partial months. */
export function rentForRange(rentRows, start, end, { clampToNow = true } = {}) {
  if (!rentRows || !rentRows.length) return { cents: 0, full: 0, partial: false };
  const now = Date.now();
  const effectiveEnd = clampToNow ? Math.min(end, now) : end;
  let accrued = 0;
  let full = 0;
  for (const row of rentRows) {
    const [y, m] = String(row.month).split('-').map(Number);
    if (!y || !m) continue;
    const monthStart = new Date(y, m - 1, 1).getTime();
    const monthEnd = new Date(y, m, 0, 23, 59, 59, 999).getTime();
    const span = monthEnd - monthStart;
    const whole = Math.min(end, monthEnd) - Math.max(start, monthStart);
    if (whole > 0) full += row.cents * (whole / span);
    const elapsed = Math.min(effectiveEnd, monthEnd) - Math.max(start, monthStart);
    if (elapsed > 0) accrued += row.cents * (elapsed / span);
  }
  return {
    cents: Math.round(accrued),
    full: Math.round(full),
    partial: end > now && Math.round(full) > Math.round(accrued)
  };
}
