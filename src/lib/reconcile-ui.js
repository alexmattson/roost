const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const FINDING_LABELS = {
  'quail-sale-missing-in-sandpiper': 'Sold in Quail, unknown to Sandpiper',
  'sold-in-quail-not-in-sandpiper': 'Sold in Quail, still unsold in Sandpiper',
  'sandpiper-sale-missing-in-quail': 'Sold in Sandpiper, no Quail record',
  'direct-channel-sale': 'Direct-channel sale (no register expected)',
  'probable-untagged-match': 'POS sale, probable match',
  'quail-sale-untagged': 'POS sale with no inventory tag',
  'price-mismatch': 'Sale price disagrees',
  'commission-mismatch': 'Commission disagrees',
  'late-entry': 'Recorded late',
  'duplicate-inventory-number': 'Duplicate inventory number'
};

export const findingKey = (f, i) => `${f.type}|${(f.item && f.item.id) || (f.quail && f.quail.id) || i}`;
export const matchOf = (entry) => (entry.plan ? entry.plan.confidence : 'manual');

const MATCH_HINT = {
  exact: 'Same inventory number in both systems — the correction is certain.',
  probable: 'Inferred from price and timing — check before applying.',
  manual: 'No automatic fix; needs a person.'
};

/** All three matches, hovered one lit and the rest dimmed. Returns HTML. */
export function matchTip(current) {
  return ['exact', 'probable', 'manual'].map((k) =>
    `<div class="tip-match${k === current ? ' on' : ''}">`
    + `<span class="tip-key"><span class="pill ${k}">${k}</span></span>`
    + `<span>${esc(MATCH_HINT[k])}</span></div>`
  ).join('');
}
