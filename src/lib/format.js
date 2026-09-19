import { format, formatDistanceToNowStrict } from 'date-fns';

export { money, int, pct } from './charts.js';
import { int } from './charts.js';

export const days = (n) => (n == null ? '—' : `${Math.round(n)}d`);
export const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many || one + 's'}`;
export const signClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

/* Dates go through date-fns rather than hand-rolled string math. */

/** "Sep 9, 26" — the compact date used in tables. */
export const shortDate = (t) => (t ? format(t, 'MMM d, yy') : '—');

/** "Sep 9, 1:30 PM" — date with clock time, for the register ledger. */
export const dateTime = (t) => (t ? format(t, 'MMM d, h:mm a') : '—');

/** "Sep 9" — day only. */
export const dayMonth = (t) => (t ? format(t, 'MMM d') : '—');

/** "5 days ago", "2 months ago" — always relative, never falls back to a date. */
export const timeAgo = (t) => (t ? formatDistanceToNowStrict(t, { addSuffix: true }) : '');

/** Alias kept for the "updated …" subline; same behaviour now. */
export const relativeTime = timeAgo;
