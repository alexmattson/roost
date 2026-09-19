/* Turns reconciliation findings into concrete Sandpiper edits.
 *
 * Quail is the register: it knows what was actually charged and when. Where the
 * two systems disagree on a sale that both recorded, Quail wins and Sandpiper is
 * corrected to match. Where a fix would require inventing information Sandpiper
 * does not have (an item's cost, say) there is no plan and a human has to decide.
 *
 * Nothing here performs a write. planResolution() only describes one, so the
 * change can be shown to the user before anything leaves the browser.
 */

const usd = (c) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const toSeconds = (ms) => Math.round(ms / 1000);
const day = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * `exact`    — both systems recorded the same sale and disagree on a value.
 * `probable` — the pairing itself is a heuristic, so it is never resolved in bulk.
 */
export const CONFIDENCE = { exact: 'exact', probable: 'probable' };

export const RESOLVABLE_TYPES = [
  'sold-in-quail-not-in-sandpiper',
  'price-mismatch',
  'commission-mismatch',
  'late-entry',
  'probable-untagged-match'
];

/**
 * @param {object} finding  one reconciliation finding
 * @param {object} ctx      { boothByExternalId, storeIdForBooth } for venue lookup
 * @returns {object|null}   { itemId, inv, desc, type, confidence, summary, changes[] }
 */
export function planResolution(finding, ctx = {}) {
  const item = finding.item;
  const sale = finding.quail;
  if (!item || !sale) return null;

  const changes = [];
  const add = (field, label, from, to, display, displayFrom) => {
    if (from === to) return;
    changes.push({ field, label, from, to, display, displayFrom });
  };

  /* Normalised items carry `sold` in milliseconds but Sandpiper stores seconds.
   * Comparing the two units directly would make a no-op edit look like a change,
   * so the current value is converted before either comparison or display. */
  const soldSeconds = item.sold == null ? null : toSeconds(item.sold);
  const addSold = () => add(
    'sold', 'Sold date', soldSeconds, toSeconds(sale.soldAt),
    day(sale.soldAt), item.sold == null ? 'not sold' : day(item.sold)
  );
  const money = (v) => (v == null ? '—' : usd(v));

  switch (finding.type) {
    case 'sold-in-quail-not-in-sandpiper': {
      addSold();
      add('soldPrice', 'Sold price', item.soldPrice, sale.price, usd(sale.price), money(item.soldPrice));
      add('consignmentPaid', 'Commission', item.commission, sale.consignment, usd(sale.consignment), money(item.commission));
      add('cardFees', 'Card fees', item.fees, sale.cardFee, usd(sale.cardFee), money(item.fees));
      const boothId = ctx.boothByExternalId && ctx.boothByExternalId[sale.boothId];
      if (boothId) {
        add('soldBooth', 'Booth', item.booth, boothId, sale.boothNumber || 'matched booth', item.booth ? 'other booth' : 'none');
        const storeId = ctx.storeIdForBooth && ctx.storeIdForBooth[boothId];
        if (storeId) add('soldStore', 'Store', item.store, storeId, sale.storeName || 'matched store', item.store ? 'other store' : 'none');
      }
      break;
    }
    case 'price-mismatch':
      add('soldPrice', 'Sold price', item.soldPrice, sale.price, usd(sale.price), money(item.soldPrice));
      break;
    case 'commission-mismatch':
      add('consignmentPaid', 'Commission', item.commission, sale.consignment, usd(sale.consignment), money(item.commission));
      break;
    case 'late-entry':
      addSold();
      break;
    case 'probable-untagged-match': {
      // The pairing is inferred, so only align values that actually differ.
      addSold();
      add('soldPrice', 'Sold price', item.soldPrice, sale.price, usd(sale.price), money(item.soldPrice));
      add('consignmentPaid', 'Commission', item.commission, sale.consignment, usd(sale.consignment), money(item.commission));
      break;
    }
    default:
      return null;
  }

  if (!changes.length) return null;

  return {
    itemId: item.id,
    inv: item.inv,
    desc: item.desc,
    type: finding.type,
    confidence: finding.type === 'probable-untagged-match' ? CONFIDENCE.probable : CONFIDENCE.exact,
    summary: changes.map((c) => `${c.label} → ${c.display}`).join(', '),
    changes
  };
}

/** Every finding that can be turned into an edit, in the order they were reported. */
export function planAll(findings, ctx = {}) {
  const plans = [];
  const seen = new Set();
  for (const f of findings) {
    const plan = planResolution(f, ctx);
    if (!plan) continue;
    // One edit per item per pass; a second finding on the same item is picked up
    // on the next run, once the first correction has landed.
    if (seen.has(plan.itemId)) continue;
    seen.add(plan.itemId);
    plans.push(plan);
  }
  return plans;
}

/**
 * Builds the payload for POST /api/items/v2/<account>/edit, which expects the
 * whole item rather than a patch — so this starts from the untouched API row and
 * overlays only the planned fields.
 */
export function buildEditPayload(rawItem, changes) {
  if (!rawItem) throw new Error('Original item record is missing.');
  const payload = { ...rawItem };
  for (const c of changes) payload[c.field] = c.to;
  // Sandpiper returns these as fractional seconds; send plain integers back.
  for (const field of ['acquired', 'sold']) {
    if (typeof payload[field] === 'number') payload[field] = Math.round(payload[field]);
  }
  return payload;
}

/** Venue lookup so a newly recorded sale lands in the right booth and store. */
export function buildVenueContext(venueInfo) {
  const boothByExternalId = {};
  const storeIdForBooth = {};
  const booths = (venueInfo && venueInfo.booths) || {};
  for (const [uuid, info] of Object.entries(booths)) {
    if (info && info.externalId != null) boothByExternalId[info.externalId] = uuid;
    if (info && info.storeId) storeIdForBooth[uuid] = info.storeId;
  }
  return { boothByExternalId, storeIdForBooth };
}
