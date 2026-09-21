import { describe, it, expect } from 'vitest';
import { buildChannels, channelRollup, CHANNEL } from '../lib/channel.js';
import { reconcile } from '../lib/reconcile.js';

const venueInfo = {
  stores: { s1: { name: 'Main St' }, fb: { name: 'Facebook Marketplace', externalId: null } },
  booths: {
    b1: { name: 'A1', storeId: 's1', externalId: 'qb1' },   // Quail-linked → POS
    fbB: { name: 'FB', storeId: 'fb', externalId: null }     // unlinked → Direct
  }
};

describe('channel model', () => {
  const ch = buildChannels(venueInfo, {});

  it('types a Quail-linked booth as POS', () => {
    expect(ch.of({ booth: 'b1', store: 's1' }).type).toBe(CHANNEL.POS);
  });
  it('types an unlinked booth as Direct', () => {
    expect(ch.of({ booth: 'fbB', store: 'fb' }).type).toBe(CHANNEL.DIRECT);
  });
  it('types a store-only unlinked sale as Direct', () => {
    expect(ch.of({ store: 'fb' }).type).toBe(CHANNEL.DIRECT);
  });
  it('types a sale with no venue as Unassigned', () => {
    expect(ch.of({}).type).toBe(CHANNEL.UNASSIGNED);
  });
  it('tag() stamps channel fields', () => {
    const t = ch.tag({ id: 'x', booth: 'fbB', store: 'fb' });
    expect(t.channelType).toBe(CHANNEL.DIRECT);
    expect(t.channel).toBe('fbB');
    expect(t.channelLabel).toBe('FB');
  });
  it('channelRollup sums per channel', () => {
    const rows = channelRollup([
      ch.tag({ booth: 'b1', store: 's1', soldPrice: 1000, net: 800, cost: 400, profit: 400 }),
      ch.tag({ booth: 'b1', store: 's1', soldPrice: 2000, net: 1600, cost: 500, profit: 1100 }),
      ch.tag({ booth: 'fbB', store: 'fb', soldPrice: 5000, net: 5000, cost: 1000, profit: 4000 })
    ]);
    const pos = rows.find((r) => r.id === 'b1');
    const direct = rows.find((r) => r.id === 'fbB');
    expect(pos.units).toBe(2);
    expect(pos.gross).toBe(3000);
    expect(direct.type).toBe(CHANNEL.DIRECT);
    expect(direct.profit).toBe(4000);
  });

  it('reconcile treats a direct sale as a quiet note, not a Quail anomaly, and keeps it out of POS totals', () => {
    const day = (d) => Date.now() - d * 86400000;
    const items = [ch.tag({
      id: 'd1', inv: '0200', desc: 'Sideboard', isSold: true, sold: day(2),
      soldPrice: 18000, commission: 0, fees: 0, cost: 5000, net: 18000, profit: 13000,
      booth: 'fbB', store: 'fb'
    })];
    const { findings, totals } = reconcile(items, [], { start: day(30), end: Date.now() + 86400000 });
    expect(findings.some((f) => f.type === 'direct-channel-sale')).toBe(true);
    expect(findings.some((f) => f.type === 'sandpiper-sale-missing-in-quail')).toBe(false);
    expect(totals.sandpiperGross).toBe(0); // direct sale excluded from POS agreement totals
  });
});
