import { describe, it, expect } from 'vitest';
import { parsePins, serializePins, addSalePin, addInvAlias, pinsSale } from '../lib/pins.js';
import { reconcile } from '../lib/reconcile.js';

describe('pins (notes markers)', () => {
  it('round-trips human text and markers', () => {
    const notes = addSalePin('Chipped rim', 65162791);
    expect(notes).toContain('Chipped rim');
    const p = parsePins(notes);
    expect(p.human).toBe('Chipped rim');
    expect(p.qsale).toEqual(['65162791']);
  });

  it('is idempotent and merges multiple pins', () => {
    let n = addSalePin('', 100);
    n = addSalePin(n, 100);           // duplicate — no-op
    n = addSalePin(n, 200);
    n = addInvAlias(n, '0114');
    const p = parsePins(n);
    expect(p.qsale).toEqual(['100', '200']);
    expect(p.qinv).toEqual(['0114']);
    expect(pinsSale(n, 100)).toBe(true);
    expect(pinsSale(n, 999)).toBe(false);
  });

  it('drops the marker block when empty', () => {
    expect(serializePins('just a note', {})).toBe('just a note');
    expect(serializePins('', {})).toBe('');
  });

  it('preserves an existing note when adding a pin', () => {
    const p = parsePins(addInvAlias('Fragile — handle with care', '0078'));
    expect(p.human).toBe('Fragile — handle with care');
    expect(p.qinv).toEqual(['0078']);
  });
});

describe('reconcile honours pins', () => {
  const day = (d) => Date.now() - d * 86400000;
  const range = { start: day(365), end: Date.now() + 86400000 };

  it('matches an untagged sale pinned by qsale', () => {
    const items = [{
      id: 'a1', inv: '0078', desc: 'Brass Candlestick Holder',
      sold: day(3), soldPrice: 1500, commission: 225, fees: 0,
      notes: addSalePin('', 900001)
    }];
    const sales = [{ id: 900001, inv: '', desc: 'brass candlestick', price: 1500, consignment: 225, cardFee: 0, soldAt: day(3), boothId: 'b' }];
    const { findings, totals } = reconcile(items, sales, range);
    expect(totals.matched).toBe(1);
    // No "untagged" or "probable" finding — the pin resolved it outright.
    expect(findings.some((f) => f.type === 'probable-untagged-match' || f.type === 'quail-sale-untagged')).toBe(false);
  });

  it('keeps mapping after a Sandpiper renumber via a qinv alias', () => {
    // Item was renumbered 0114 -> 0114b, but still answers to 0114 for old sales.
    const items = [{
      id: 'a2', inv: '0114b', desc: 'Renumbered thing',
      sold: day(2), soldPrice: 5000, commission: 750, fees: 0,
      notes: addInvAlias('', '0114')
    }];
    const sales = [{ id: 7, inv: '0114', desc: 'Renumbered thing', price: 5000, consignment: 750, cardFee: 0, soldAt: day(2), boothId: 'b' }];
    const { totals, findings } = reconcile(items, sales, range);
    expect(totals.matched).toBe(1);
    expect(findings.some((f) => f.type === 'quail-sale-missing-in-sandpiper')).toBe(false);
  });

  it('a pinned sale still flags a real price disagreement', () => {
    const items = [{
      id: 'a3', inv: '0050', desc: 'Lamp', sold: day(1), soldPrice: 9000, commission: 0, fees: 0,
      notes: addSalePin('', 42)
    }];
    const sales = [{ id: 42, inv: '', desc: 'lamp', price: 8000, consignment: 0, cardFee: 0, soldAt: day(1), boothId: 'b' }];
    const { findings } = reconcile(items, sales, range);
    expect(findings.some((f) => f.type === 'price-mismatch')).toBe(true);
  });
});
