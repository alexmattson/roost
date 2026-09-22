import { describe, it, expect } from 'vitest';
import { collectChanges, editFields } from '../lib/items.js';

// A minimal on-hand (unsold) item.
const onHand = {
  inv: '0100', desc: 'Vintage chair', acquired: null,
  cost: 0, restoration: 0, ask: 5000,
  isSold: false, sold: null, soldPrice: null, booth: null, store: null
};

// A sold item whose stored timestamp carries a time-of-day (not midnight/noon).
const sold = {
  inv: '0101', desc: 'Brass lamp', acquired: null,
  cost: 0, restoration: 0, ask: 7500,
  isSold: true, sold: new Date('2026-09-20T15:37:00').getTime(), soldPrice: 7500,
  booth: null, store: null
};

const change = (list, field) => list.find((c) => c.field === field);

describe('collectChanges — marking items sold', () => {
  it('marks an on-hand item sold when a date and price are entered', () => {
    const f = { ...editFields(onHand), sold: '2026-09-20', soldPrice: '65' };
    const ch = collectChanges(onHand, f);
    expect(change(ch, 'sold')).toBeTruthy();
    expect(change(ch, 'sold').to).toBeGreaterThan(0);
    expect(change(ch, 'soldPrice').to).toBe(6500);
  });

  it('does not touch sold fields when an on-hand item is edited without them', () => {
    const f = { ...editFields(onHand), desc: 'Vintage oak chair' };
    const ch = collectChanges(onHand, f);
    expect(change(ch, 'description')).toBeTruthy();
    expect(change(ch, 'sold')).toBeFalsy();
    expect(change(ch, 'soldPrice')).toBeFalsy(); // empty price must not push soldPrice: 0
  });

  it('re-saving an unchanged sold item pushes no spurious sold change', () => {
    const ch = collectChanges(sold, editFields(sold));
    expect(change(ch, 'sold')).toBeFalsy();      // day-granular, no noon snap
    expect(change(ch, 'soldPrice')).toBeFalsy();
  });

  it('clearing the sold date returns the item to on-hand (sold: 0)', () => {
    const f = { ...editFields(sold), sold: '' };
    const ch = collectChanges(sold, f);
    expect(change(ch, 'sold').to).toBe(0);
  });
});
