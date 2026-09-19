/* Cross-checks Sandpiper's inventory records against Quail's POS records.
 *
 * The two systems are joined on inventory number (Sandpiper `inventoryNumber`
 * <-> Quail `inventory`). Neither side is authoritative on its own:
 *   - Quail knows what actually rang up, and when.
 *   - Sandpiper knows what the item cost and what it was meant to sell for.
 * Anything that appears in one and not the other, or disagrees on price or
 * commission, is worth a human look.
 */

import { DAY } from './analytics.js';

export const SEVERITY = { high: 3, medium: 2, low: 1 };

// Prices are compared with a small tolerance so rounding never raises a flag.
const CENT_TOLERANCE = 2;
/** Cents -> "$12.34". Local so this stays free of UI dependencies. */
const usd = (c) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const norm = (inv) => String(inv || '').trim().toLowerCase().replace(/^0+(?=\d)/, '');

function indexBy(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = norm(r[key]);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/**
 * @param {Array} items      normalised Sandpiper items
 * @param {Array} quailSales normalised Quail sales
 * @param {{start:number,end:number}} range  only sales inside this window are judged
 */
export function reconcile(items, quailSales, range) {
  const { start, end } = range;
  const findings = [];
  const add = (f) => findings.push(f);

  const quailInRange = quailSales.filter((s) => s.soldAt >= start && s.soldAt <= end);
  const spSoldInRange = items.filter((i) => i.sold != null && i.sold >= start && i.sold <= end);

  const spByInv = indexBy(items, 'inv');
  const quailByInv = indexBy(quailSales, 'inv');

  // Sandpiper reuses inventory numbers, which makes any join ambiguous.
  for (const [key, rows] of spByInv) {
    if (rows.length > 1) {
      add({
        type: 'duplicate-inventory-number',
        severity: 'low',
        inv: rows[0].inv,
        detail: `${rows.length} Sandpiper items share inventory #${rows[0].inv}`,
        items: rows.map((r) => r.desc),
        note: 'Matching against Quail is ambiguous while numbers repeat.'
      });
    }
    void key;
  }

  const matched = [];
  const untagged = [];

  for (const sale of quailInRange) {
    if (!sale.inv) {
      untagged.push(sale);
      continue;
    }
    const candidates = spByInv.get(norm(sale.inv)) || [];
    if (!candidates.length) {
      add({
        type: 'quail-sale-missing-in-sandpiper',
        severity: 'high',
        soldAt: sale.soldAt,
        inv: sale.inv,
        detail: `Quail sold #${sale.inv} "${sale.desc}" but Sandpiper has no such item`,
        quail: sale
      });
      continue;
    }
    // Prefer an item Sandpiper also marks sold, nearest in time to the POS sale.
    const sold = candidates.filter((c) => c.sold != null);
    const pick = (sold.length ? sold : candidates)
      .slice()
      .sort((a, b) => Math.abs((a.sold || 0) - sale.soldAt) - Math.abs((b.sold || 0) - sale.soldAt))[0];

    matched.push({ sale, item: pick });

    if (pick.sold == null) {
      add({
        type: 'sold-in-quail-not-in-sandpiper',
        severity: 'high',
        soldAt: sale.soldAt,
        inv: sale.inv,
        detail: `#${sale.inv} "${pick.desc}" sold in Quail but is still marked unsold in Sandpiper`,
        quail: sale,
        item: pick,
        note: 'Inventory and potential-profit figures are overstated until this is recorded.'
      });
      continue;
    }

    if (Math.abs(pick.soldPrice - sale.price) > CENT_TOLERANCE) {
      add({
        type: 'price-mismatch',
        severity: 'high',
        soldAt: sale.soldAt,
        inv: sale.inv,
        detail: `#${sale.inv} "${pick.desc}": Sandpiper ${usd(pick.soldPrice)}, Quail ${usd(sale.price)}`,
        delta: pick.soldPrice - sale.price,
        quail: sale,
        item: pick
      });
    }

    if (Math.abs(pick.commission - sale.consignment) > CENT_TOLERANCE) {
      add({
        type: 'commission-mismatch',
        severity: 'medium',
        soldAt: sale.soldAt,
        inv: sale.inv,
        detail: `#${sale.inv} "${pick.desc}": commission ${usd(pick.commission)} vs Quail ${usd(sale.consignment)}`,
        delta: pick.commission - sale.consignment,
        quail: sale,
        item: pick
      });
    }

    // Quail is authoritative on timing; a large gap means slow bookkeeping.
    const lag = (pick.sold - sale.soldAt) / DAY;
    if (lag > 3) {
      add({
        type: 'late-entry',
        severity: 'low',
        soldAt: sale.soldAt,
        inv: sale.inv,
        detail: `#${sale.inv} "${pick.desc}" recorded ${Math.round(lag)} days after it sold`,
        lagDays: lag,
        quail: sale,
        item: pick
      });
    }
  }

  // The other direction: Sandpiper thinks it sold, Quail never saw it.
  const matchedItemIds = new Set(matched.map((m) => m.item.id));
  const orphanItems = spSoldInRange.filter((item) => {
    if (matchedItemIds.has(item.id)) return false;
    const anyQuail = quailByInv.get(norm(item.inv)) || [];
    return !anyQuail.some((s) => Math.abs(s.soldAt - item.sold) < 30 * DAY);
  });

  /* An untagged POS sale and an unmatched Sandpiper sale at the same price and
   * around the same time are almost certainly the same event — the tag simply
   * wasn't scanned. Pairing them turns two puzzling findings into one actionable
   * one, and stops the same sale being counted as both a gap and a surplus. */
  const pairedItems = new Set();
  const pairedSales = new Set();
  for (const sale of untagged) {
    const candidate = orphanItems
      .filter((i) => !pairedItems.has(i.id))
      .filter((i) => Math.abs(i.soldPrice - sale.price) <= CENT_TOLERANCE)
      .filter((i) => Math.abs(i.sold - sale.soldAt) <= 2 * DAY)
      .sort((a, b) => Math.abs(a.sold - sale.soldAt) - Math.abs(b.sold - sale.soldAt))[0];
    if (!candidate) continue;
    pairedItems.add(candidate.id);
    pairedSales.add(sale.id);
    add({
      type: 'probable-untagged-match',
      severity: 'medium',
      soldAt: sale.soldAt,
      inv: candidate.inv,
      detail: `Untagged Quail sale "${sale.desc}" (${usd(sale.price)}) most likely is Sandpiper #${candidate.inv} "${candidate.desc}"`,
      quail: sale,
      item: candidate,
      note: 'Same price, within two days. The POS sale carried no inventory tag.'
    });
  }

  for (const sale of untagged) {
    if (pairedSales.has(sale.id)) continue;
    add({
      type: 'quail-sale-untagged',
      severity: 'medium',
      soldAt: sale.soldAt,
      detail: `Sold "${sale.desc}" for ${usd(sale.price)} with no inventory number`,
      quail: sale,
      note: 'Rang up at the POS without an inventory tag, so it cannot be traced to a Sandpiper item.'
    });
  }

  for (const item of orphanItems) {
    if (pairedItems.has(item.id)) continue;
    add({
      type: 'sandpiper-sale-missing-in-quail',
      severity: 'medium',
      soldAt: item.sold,
      inv: item.inv,
      detail: `#${item.inv} "${item.desc}" marked sold in Sandpiper with no matching Quail sale`,
      item,
      note: 'Expected for sales made outside this booth, or if the Quail window does not cover it.'
    });
  }

  const totals = {
    quailSales: quailInRange.length,
    sandpiperSales: spSoldInRange.length,
    matched: matched.length,
    quailGross: quailInRange.reduce((a, s) => a + s.price, 0),
    sandpiperGross: spSoldInRange.reduce((a, i) => a + (i.soldPrice || 0), 0)
  };
  totals.grossDelta = totals.sandpiperGross - totals.quailGross;
  totals.matchRate = quailInRange.length ? matched.length / quailInRange.length : null;

  const rank = (f) => SEVERITY[f.severity] || 0;
  findings.sort((a, b) => rank(b) - rank(a) || (b.soldAt || 0) - (a.soldAt || 0));

  const byType = {};
  for (const f of findings) byType[f.type] = (byType[f.type] || 0) + 1;

  return { findings, totals, byType, matched };
}
