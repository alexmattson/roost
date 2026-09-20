/**
 * Durable Quail↔Sandpiper links, stored in the Sandpiper item's own `notes`
 * field — the one place we can write that persists in their system.
 *
 * Quail's vendor API is read-only, so a sale's inventory number can't be fixed
 * there, and a renumber in Sandpiper would orphan its past Quail sales. Instead
 * we stamp a small, fenced marker into the item's notes:
 *
 *     Any human note text… ⟦roost qsale:65162791,65162792 qinv:0114⟧
 *
 *   qsale : Quail sale id(s) that belong to this item — the strong link. Being
 *           the sale's own id, it survives renumbering, duplicate numbers and
 *           missing tags entirely.
 *   qinv  : alternate inventory number(s) the item also answers to — lets you
 *           renumber in Sandpiper while old Quail sales keep matching.
 *
 * reconcile() honours these before the number-based join, so a pinned sale is
 * always reconcilable. Human text before the fence is preserved untouched.
 */

const FENCE_RE = /\s*⟦roost\b([^⟧]*)⟧\s*/;
const uniq = (arr) => [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];

/** Split notes into its human text and the roost markers. */
export function parsePins(notes) {
  const s = String(notes || '');
  const m = s.match(FENCE_RE);
  const human = m ? (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim() : s.trim();
  const pins = { qsale: [], qinv: [] };
  if (m) {
    for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) {
      const i = tok.indexOf(':');
      if (i < 0) continue;
      const key = tok.slice(0, i);
      if (key !== 'qsale' && key !== 'qinv') continue;
      pins[key] = uniq([...pins[key], ...tok.slice(i + 1).split(',')]);
    }
  }
  return { human, qsale: pins.qsale, qinv: pins.qinv };
}

/** Rebuild a notes string from human text plus markers (marker dropped if empty). */
export function serializePins(human, { qsale = [], qinv = [] } = {}) {
  const parts = [];
  const s = uniq(qsale);
  const v = uniq(qinv);
  if (s.length) parts.push(`qsale:${s.join(',')}`);
  if (v.length) parts.push(`qinv:${v.join(',')}`);
  const block = parts.length ? `⟦roost ${parts.join(' ')}⟧` : '';
  const h = String(human || '').trim();
  return [h, block].filter(Boolean).join(h && block ? ' ' : '');
}

/** Notes with `saleId` added to the item's qsale links (idempotent). */
export function addSalePin(notes, saleId) {
  const p = parsePins(notes);
  return serializePins(p.human, { qsale: [...p.qsale, saleId], qinv: p.qinv });
}

/** Notes with `inv` added as an alternate inventory number (idempotent). */
export function addInvAlias(notes, inv) {
  const p = parsePins(notes);
  return serializePins(p.human, { qsale: p.qsale, qinv: [...p.qinv, inv] });
}

/** Convenience: does this item's notes pin the given sale id? */
export function pinsSale(notes, saleId) {
  return parsePins(notes).qsale.includes(String(saleId).trim());
}
