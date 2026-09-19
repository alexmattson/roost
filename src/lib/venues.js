import { UNASSIGNED, shortId } from './analytics.js';

export function makeVenueLabels(venueInfo, venueNames) {
  const info = (id, kind) => {
    const bucket = kind === 'store' ? venueInfo.stores : venueInfo.booths;
    return (bucket && bucket[id]) || null;
  };
  const label = (id, kind) => {
    if (id === UNASSIGNED || !id) return kind === 'store' ? 'No store recorded' : 'No booth recorded';
    const i = info(id, kind);
    return venueNames[id] || (i && i.name) || `${kind === 'store' ? 'Store' : 'Booth'} ${shortId(id)}`;
  };
  const location = (id) => {
    const i = info(id, 'store');
    if (!i) return '—';
    return [i.city, i.state].filter(Boolean).join(', ') || '—';
  };
  const boothStore = (row) => { const i = info(row.id, 'booth'); return (i && i.storeId) || row.store; };
  return { info, label, location, boothStore };
}
