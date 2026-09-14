/**
 * Adding stock.
 *
 * Sandpiper's own Add Item dialog asks for six fields and knows nothing about
 * the rest of your inventory, so it cannot tell you that 01718 is already
 * taken, what the last three of these sold for, or what you will actually be
 * left with after the store's cut. Roost has the whole cache in memory, so it
 * can answer all three while you type.
 *
 * Everything here is pure: it takes normalised items and draft rows and returns
 * numbers and findings. The DOM work lives in popup.js, the network call in
 * background.js.
 */

import { categorize } from './analytics.js';

/** Words too common to say anything about what an item is. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'with', 'for', 'in', 'on', 'set', 'pair',
  'vintage', 'antique', 'old', 'large', 'small', 'mid', 'century', 'style'
]);

const words = (s) => (s || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter((w) => w.length > 2 && !STOPWORDS.has(w));

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ------------------------------------------------------------------ numbers */

/**
 * The next inventory number to issue.
 *
 * Sandpiper increments the number you last typed and pads it back to that
 * number's width, which is why a shop that started at 0001 stays four wide
 * until it rolls over. We do the same from the highest number on record rather
 * than from the last one typed, so two people adding stock on two machines
 * still cannot collide.
 *
 * Gaps are deliberately not filled. A gap usually means a deleted item whose
 * printed tag is still out there in a booth somewhere, and reissuing that
 * number would make the next reconciliation ambiguous.
 */
export function nextInventoryNumber(items) {
  let best = null;
  for (const it of items || []) {
    const raw = String(it.inv || '').trim();
    if (!/^\d+$/.test(raw)) continue;          // lettered schemes are left alone
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) continue;
    if (!best || n > best.n) best = { n, width: raw.length };
  }
  if (!best) return '0001';
  return String(best.n + 1).padStart(best.width, '0');
}

/** Increments a number the user typed, keeping their padding. */
export function bumpInventoryNumber(inv) {
  const raw = String(inv || '').trim();
  if (!/^\d+$/.test(raw)) return '';
  return String(parseInt(raw, 10) + 1).padStart(raw.length, '0');
}

/**
 * Numbers already spoken for, as a lookup.
 *
 * Compared numerically as well as literally: 0156 and 00156 are different
 * strings but the same tag on a shelf, and Sandpiper will happily hold both.
 */
export function takenNumbers(items) {
  const taken = new Map();
  for (const it of items || []) {
    const raw = String(it.inv || '').trim();
    if (!raw) continue;
    const key = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw.toLowerCase();
    if (!taken.has(key)) taken.set(key, it);
  }
  return taken;
}

const numberKey = (inv) => {
  const raw = String(inv || '').trim();
  return /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw.toLowerCase();
};

/* ------------------------------------------------------------------- prices */

/**
 * What items like this one have done before.
 *
 * Scored on shared significant words first, falling back to the inferred
 * category, because "walnut dresser" should learn from your other dressers
 * before it learns from furniture in general. Only sold items count — asking
 * prices on unsold stock are guesses, and averaging in the ones that have sat
 * for two years is how you end up repeating the mistake.
 */
export function priceHistory(desc, items, { minMatches = 2 } = {}) {
  const want = new Set(words(desc));
  if (!want.size) return null;

  const cat = categorize(desc);
  const scored = [];
  for (const it of items || []) {
    if (!it.isSold || !(it.soldPrice > 0)) continue;
    const have = words(it.desc);
    const shared = have.filter((w) => want.has(w)).length;
    if (shared) scored.push({ it, score: shared + (it.category === cat ? 0.5 : 0) });
    else if (it.category === cat && cat !== 'Other') scored.push({ it, score: 0.5 });
  }
  if (scored.length < minMatches) return null;

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 25);
  const exact = top.filter((s) => s.score >= 1.5).length;
  const rows = top.map((s) => s.it);

  return {
    n: rows.length,
    /* Says which question the numbers answer: a handful of genuinely similar
     * items, or the whole category standing in for them. */
    basis: exact >= minMatches ? 'similar items' : `${cat.toLowerCase()} overall`,
    soldMedian: median(rows.map((r) => r.soldPrice)),
    askMedian: median(rows.filter((r) => r.ask > 0).map((r) => r.ask)),
    daysMedian: median(rows.filter((r) => r.daysToSell != null).map((r) => r.daysToSell)),
    /* How far under asking these actually went, so a suggested price can be
     * honest about the haggling that follows it. */
    discount: median(rows.filter((r) => r.discount != null).map((r) => r.discount))
  };
}

/** What an asking price is actually worth once the store takes its cut. */
export function margin(askCents, costCents, commissionRate) {
  const ask = Number(askCents) || 0;
  const cost = Number(costCents) || 0;
  const rate = Number(commissionRate) || 0;
  const net = ask * (1 - rate);
  return {
    net,
    profit: net - cost,
    /* Margin is against what the customer pays, matching how the rest of the
     * app reports it. */
    margin: ask > 0 ? (net - cost) / ask : null,
    markup: cost > 0 ? ask / cost : null
  };
}

/**
 * Spreads one lot price across the things that came in it.
 *
 * Weighted by asking price where possible: a $60 box holding a $200 lamp and
 * eleven $5 glasses did not cost $5 a piece, and splitting it evenly would
 * report the lamp as pure profit and every glass as a loss. Falls back to an
 * even split when nothing has been priced yet.
 *
 * The remainder is handed out a cent at a time so the parts always add back up
 * to the lot price exactly.
 */
export function splitLotCost(totalCents, rows, { mode = 'auto' } = {}) {
  const total = Math.max(0, Math.round(Number(totalCents) || 0));
  const n = rows.length;
  if (!n || !total) return rows.map(() => 0);

  const asks = rows.map((r) => Math.max(0, Number(r.askCents) || 0));
  const askSum = asks.reduce((a, b) => a + b, 0);
  const weighted = mode === 'weighted' || (mode === 'auto' && askSum > 0 && asks.every((a) => a > 0));

  let parts;
  if (weighted) parts = asks.map((a) => Math.floor((total * a) / askSum));
  else parts = rows.map(() => Math.floor(total / n));

  let left = total - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % n, left--) parts[i] += 1;
  return parts;
}

/* ---------------------------------------------------------------- the draft */

export const blankRow = (inv = '') => ({
  inv,
  desc: '',
  costCents: null,
  askCents: null,
  qty: 1
});

/** True when a row holds nothing worth keeping or complaining about. */
export const isRowEmpty = (r) =>
  !String(r.desc || '').trim() && r.costCents == null && r.askCents == null;

/**
 * What is wrong with a row, and what merely deserves a second look.
 *
 * Errors block the write because Sandpiper would either reject them or store
 * something you cannot reconcile later. Warnings never block: a $0 cost is
 * entirely normal for something rescued from a kerb, and pricing below cost is
 * sometimes a deliberate decision to stop paying rent on it.
 */
export function validateRow(row, { taken, draftCounts, commissionRate = 0 } = {}) {
  const errors = [];
  const warnings = [];

  const inv = String(row.inv || '').trim();
  const desc = String(row.desc || '').trim();

  if (!inv) errors.push('Needs an inventory number.');
  if (!desc) errors.push('Needs a description.');

  if (inv) {
    const key = numberKey(inv);
    const clash = taken && taken.get(key);
    if (clash) errors.push(`#${inv} is already ${clash.desc === '(no description)' ? 'in use' : `"${clash.desc}"`}.`);
    else if (draftCounts && (draftCounts.get(key) || 0) > 1) errors.push(`#${inv} is used twice in this batch.`);
  }

  const qty = Number(row.qty) || 1;
  if (!Number.isInteger(qty) || qty < 1) errors.push('Quantity must be a whole number of at least 1.');
  if (qty > 1 && inv) {
    /* Sandpiper stamps every copy with the same number, so a quantity above one
     * plants the duplicate that Review will later report. Worth saying before
     * it happens rather than after. */
    warnings.push(`${qty} copies will share #${inv}, which Review reports as a duplicate.`);
  }

  if (row.askCents != null && row.costCents != null && row.askCents > 0) {
    const m = margin(row.askCents, row.costCents, commissionRate);
    if (m.profit < 0) warnings.push('Asking price does not cover its cost after commission.');
  }
  if (desc.length > 60) warnings.push('Long descriptions get cut off on receipts.');

  return { errors, warnings, ok: !errors.length };
}

/** Draft-wide number counts, so two rows claiming one number both light up. */
export function draftNumberCounts(rows) {
  const counts = new Map();
  for (const r of rows) {
    const key = numberKey(r.inv);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * The exact object Sandpiper's create endpoint expects.
 *
 * Money goes over in cents and the date as unix seconds. `originalCost` and
 * `totalCost` are both set to what you paid: they only diverge once an expense
 * is recorded against the item, which happens in Sandpiper, not here.
 */
export function buildCreatePayload(row, { acquired }) {
  const cost = Math.max(0, Math.round(Number(row.costCents) || 0));
  return {
    id: '',
    inventoryNumber: String(row.inv || '').trim(),
    description: String(row.desc || '').trim(),
    acquired: Math.round(acquired),
    originalCost: cost,
    totalCost: cost,
    askingPrice: Math.max(0, Math.round(Number(row.askCents) || 0))
  };
}

/** What the batch adds up to, for the bar above the button. */
export function draftTotals(rows, commissionRate) {
  const live = rows.filter((r) => !isRowEmpty(r));
  let items = 0, cost = 0, ask = 0;
  for (const r of live) {
    const qty = Math.max(1, Number(r.qty) || 1);
    items += qty;
    cost += (Number(r.costCents) || 0) * qty;
    ask += (Number(r.askCents) || 0) * qty;
  }
  const m = margin(ask, cost, commissionRate);
  return { rows: live.length, items, cost, ask, net: m.net, profit: m.profit };
}
