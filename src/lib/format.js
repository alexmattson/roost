export { money, int, pct } from './charts.js';
import { int } from './charts.js';

export const days = (n) => (n == null ? '—' : `${Math.round(n)}d`);
export const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many || one + 's'}`;
export const signClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

/** Compact, always-relative — fits a narrow column at any age. */
export function timeAgo(t) {
  const day = 86400000;
  const diff = Date.now() - t;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < day) return `${Math.round(diff / 3600000)}h ago`;
  const d = Math.round(diff / day);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.round(d / 7)}w ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

/** Relative for recent, absolute date+time once older — for "updated …" lines. */
export function relativeTime(t) {
  const diff = Date.now() - t;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const shortDate = (t) =>
  new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
