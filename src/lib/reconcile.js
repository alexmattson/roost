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
import { parsePins } from './pins.js';

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

  /* Durable links stamped into Sandpiper notes (see lib/pins.js): a Quail sale
   * id pinned to an item, or an alternate inventory number the item also answers
   * to. These override the number-based join, so a renumbered, duplicated or
   * untagged sale still maps. Aliases are folded into the number index; sale
   * pins take outright priority in the loop below. */
  const salePinToItem = new Map();
  for (const it of items) {
    const p = parsePins(it.notes);
    for (const sid of p.qsale) if (!salePinToItem.has(sid)) salePinToItem.set(sid, it);
    for (const alias of p.qinv) {
      const k = norm(alias);
      if (!k) continue;
      if (!spByInv.has(k)) spByInv.set(k, []);
      if (!spByInv.get(k).includes(it)) spByInv.get(k).push(it);
    }
  }

  const matched = [];
  const untagged = [];        // Quail sales with no inventory number
  const unresolvedQuail = []; // Quail sales whose number matches no Sandpiper item (e.g. renumbered)

  // A matched pair judged for value/timing disagreements, whichever way it was
  // joined (by pin or by number).
  const checkMatch = (pick, sale) => {
    if (pick.sold == null) {
      add({
        type: 'sold-in-quail-not-in-sandpiper',
        severity: 'high',
        soldAt: sale.soldAt,
        inv: pick.inv || sale.inv,
        detail: `#${pick.inv || sale.inv} "${pick.desc}" sold in Quail but is still marked unsold in Sandpiper`,
        quail: sale,
        item: pick,
        note: 'Inventory and potential-profit figures are overstated until this is recorded.'
      });
      return;
    }
    if (Math.abs(pick.soldPrice - sale.price) > CENT_TOLERANCE) {
      add({
        type: 'price-mismatch',
        severity: 'high',
        soldAt: sale.soldAt,
        inv: pick.inv || sale.inv,
        detail: `#${pick.inv || sale.inv} "${pick.desc}": Sandpiper ${usd(pick.soldPrice)}, Quail ${usd(sale.price)}`,
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
        inv: pick.inv || sale.inv,
        detail: `#${pick.inv || sale.inv} "${pick.desc}": commission ${usd(pick.commission)} vs Quail ${usd(sale.consignment)}`,
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
        inv: pick.inv || sale.inv,
        detail: `#${pick.inv || sale.inv} "${pick.desc}" recorded ${Math.round(lag)} days after it sold`,
        lagDays: lag,
        quail: sale,
        item: pick
      });
    }
  };

  for (const sale of quailInRange) {
    // A durable pin wins over everything, even an untagged or mis-numbered sale.
    const pinned = salePinToItem.get(String(sale.id));
    if (pinned) {
      matched.push({ sale, item: pinned });
      checkMatch(pinned, sale);
      continue;
    }
    if (!sale.inv) {
      untagged.push(sale);
      continue;
    }
    const candidates = spByInv.get(norm(sale.inv)) || [];
    if (!candidates.length) {
      // Number matches nothing in Sandpiper (often a renumbered item). Hold it
      // for the price/time pairing below rather than giving up immediately.
      unresolvedQuail.push(sale);
      continue;
    }
    // Prefer an item Sandpiper also marks sold, nearest in time to the POS sale.
    const sold = candidates.filter((c) => c.sold != null);
    const pick = (sold.length ? sold : candidates)
      .slice()
      .sort((a, b) => Math.abs((a.sold || 0) - sale.soldAt) - Math.abs((b.sold || 0) - sale.soldAt))[0];

    matched.push({ sale, item: pick });
    checkMatch(pick, sale);
  }

  // The other direction: Sandpiper thinks it sold, Quail never saw it.
  const matchedItemIds = new Set(matched.map((m) => m.item.id));
  const orphanItems = spSoldInRange.filter((item) => {
    if (matchedItemIds.has(item.id)) return false;
    const anyQuail = quailByInv.get(norm(item.inv)) || [];
    return !anyQuail.some((s) => Math.abs(s.soldAt - item.sold) < 30 * DAY);
  });

  /* A Quail sale with no Sandpiper match — because it was untagged, or because
   * the item was renumbered so the numbers no longer line up — and an unmatched
   * Sandpiper sale at the same price and time are almost certainly the same
   * event. Pairing them turns two puzzling findings into one linkable one, and
   * stops the sale being counted as both a gap and a surplus. Resolving it pins
   * the two together permanently (see resolve.planPin), so the link survives
   * even though the numbers differ. */
  const pairedItems = new Set();
  const pairedSales = new Set();
  for (const sale of [...untagged, ...unresolvedQuail]) {
    const candidate = orphanItems
      .filter((i) => !pairedItems.has(i.id))
      // A POS sale can't belong to a direct (non-Quail) channel.
      .filter((i) => i.channelType !== 'direct')
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
      detail: sale.inv
        ? `Quail #${sale.inv} "${sale.desc}" (${usd(sale.price)}) is most likely Sandpiper #${candidate.inv} "${candidate.desc}" — looks renumbered`
        : `Untagged Quail sale "${sale.desc}" (${usd(sale.price)}) most likely is Sandpiper #${candidate.inv} "${candidate.desc}"`,
      quail: sale,
      item: candidate,
      note: sale.inv
        ? 'Same price and time, but the inventory numbers differ. Resolve to link them permanently.'
        : 'Same price, within two days. The POS sale carried no inventory tag.'
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

  for (const sale of unresolvedQuail) {
    if (pairedSales.has(sale.id)) continue;
    add({
      type: 'quail-sale-missing-in-sandpiper',
      severity: 'high',
      soldAt: sale.soldAt,
      inv: sale.inv,
      detail: `Quail sold #${sale.inv} "${sale.desc}" but Sandpiper has no such item`,
      quail: sale
    });
  }

  for (const item of orphanItems) {
    if (pairedItems.has(item.id)) continue;
    if (item.channelType === 'direct') {
      // A direct-channel sale (Facebook, etc.) is never expected in Quail — this
      // is a quiet, informational note, not an anomaly to fix.
      add({
        type: 'direct-channel-sale',
        severity: 'low',
        soldAt: item.sold,
        inv: item.inv,
        detail: `#${item.inv} "${item.desc}" sold on ${item.channelLabel || 'a direct channel'} — no Quail record expected`,
        item,
        note: 'Recorded in Sandpiper on a non-POS channel; correctly absent from the register.'
      });
      continue;
    }
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

  // Sandpiper↔Quail agreement is a POS-channel question, so direct-channel
  // sales (never expected in the register) are excluded from these totals.
  const posSold = spSoldInRange.filter((i) => i.channelType !== 'direct');
  const totals = {
    quailSales: quailInRange.length,
    sandpiperSales: posSold.length,
    matched: matched.length,
    quailGross: quailInRange.reduce((a, s) => a + s.price, 0),
    sandpiperGross: posSold.reduce((a, i) => a + (i.soldPrice || 0), 0)
  };
  totals.grossDelta = totals.sandpiperGross - totals.quailGross;
  totals.matchRate = quailInRange.length ? matched.length / quailInRange.length : null;

  const rank = (f) => SEVERITY[f.severity] || 0;
  findings.sort((a, b) => rank(b) - rank(a) || (b.soldAt || 0) - (a.soldAt || 0));

  const byType = {};
  for (const f of findings) byType[f.type] = (byType[f.type] || 0) + 1;

  return { findings, totals, byType, matched };
}
