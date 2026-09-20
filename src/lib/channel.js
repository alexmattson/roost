/**
 * Channels — the unifying idea behind the multi-channel design.
 *
 * A channel is where a sale happened. Every Sandpiper venue is a channel:
 *   - POS (booth): carries a Quail externalId, so it rings up in Quail and has
 *     booth rent + consignment. Reconciliation polices these.
 *   - Direct: a Sandpiper store/booth with no externalId (e.g. a "Facebook
 *     Marketplace" store you create). No rent, no consignment, never in Quail.
 *   - Unassigned: a sale with no venue recorded yet.
 *
 * Channel is derived from the item's soldStore/soldBooth plus whether that venue
 * is Quail-linked — nothing new is stored on the item. `tag()` stamps
 * channelType/channel/channelLabel onto normalised or ledger items so every
 * downstream view (analytics, reconcile, the Channels hub) reads the same thing.
 */

import { UNASSIGNED } from './analytics.js';

export const CHANNEL = { POS: 'pos', DIRECT: 'direct', UNASSIGNED: 'unassigned' };
export const CHANNEL_LABEL = { pos: 'Booth', direct: 'Direct', unassigned: 'Unassigned' };

export function buildChannels(venueInfo, venueNames = {}) {
  const booths = (venueInfo && venueInfo.booths) || {};
  const stores = (venueInfo && venueInfo.stores) || {};
  const linkedBooth = (id) => !!(id && booths[id] && booths[id].externalId != null);
  const linkedStore = (id) => !!(id && stores[id] && stores[id].externalId != null);

  const label = (id, kind) => {
    if (!id || id === UNASSIGNED) return 'Unassigned';
    if (kind === 'store') return venueNames[id] || (stores[id] && stores[id].name) || 'Store';
    return venueNames[id] || (booths[id] && booths[id].name) || 'Booth';
  };

  const of = (item) => {
    const boothId = item.booth || null;
    const storeId = item.store || null;
    if (!boothId && !storeId) {
      return { type: CHANNEL.UNASSIGNED, id: UNASSIGNED, kind: null, boothId: null, storeId: null, label: 'Unassigned' };
    }
    const pos = linkedBooth(boothId) || linkedStore(storeId);
    const kind = boothId ? 'booth' : 'store';
    const id = boothId || storeId;
    return {
      type: pos ? CHANNEL.POS : CHANNEL.DIRECT,
      id, kind, boothId, storeId, label: label(id, kind)
    };
  };

  const tag = (item) => {
    const c = of(item);
    return { ...item, channel: c.id, channelType: c.type, channelLabel: c.label };
  };

  return { of, tag, label };
}

/** A per-channel rollup of sold ledger items, plus a totals footer. */
export function channelRollup(soldItems) {
  const map = new Map();
  for (const i of soldItems) {
    const key = i.channel || UNASSIGNED;
    if (!map.has(key)) {
      map.set(key, {
        id: key, type: i.channelType || CHANNEL.UNASSIGNED, label: i.channelLabel || 'Unassigned',
        units: 0, gross: 0, net: 0, cogs: 0, profit: 0, commission: 0
      });
    }
    const r = map.get(key);
    r.units += 1;
    r.gross += i.soldPrice || 0;
    r.net += i.net || 0;
    r.cogs += i.cost || 0;
    r.profit += (i.profit != null ? i.profit : 0);
    r.commission += i.commission || 0;
  }
  const rows = [...map.values()].sort((a, b) => b.gross - a.gross);
  return rows;
}
