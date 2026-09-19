import { PALETTE } from '../lib/charts.js';
import { money, int, pct } from '../lib/format.js';

export const bandUp = (v, good, watch) => (v == null || !isFinite(v) ? null : v >= good ? 'good' : v >= watch ? 'watch' : 'alert');
export const bandDown = (v, good, watch) => (v == null || !isFinite(v) ? null : v <= good ? 'good' : v <= watch ? 'watch' : 'alert');
export const bandSign = (v) => (v == null || !isFinite(v) ? null : v >= 0 ? 'good' : 'alert');

/** "▲ 23%" trend chip, or null when there's no honest comparison. */
export function Trend({ current, prior, hasData = true }) {
  if (!hasData || prior == null || prior === 0 || !isFinite(prior)) return null;
  const change = (current - prior) / Math.abs(prior);
  if (!isFinite(change) || Math.abs(change) < 0.005) return <span className="trend flat">no change</span>;
  const up = change > 0;
  return <span className={`trend ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {pct(Math.abs(change), 0)}</span>;
}

export function Legend({ series }) {
  return (
    <div className="legend-inline">
      {series.map((s, i) => <span key={i}><i className="dot" style={{ background: s.color }} />{s.name}</span>)}
    </div>
  );
}

/**
 * A read-only data table. Columns: { title, num, cls, render(row) → node }.
 * `cls` may be a string or (row) => string.
 */
export function DataTable({ rows, columns, empty = 'Nothing here yet', getKey }) {
  if (!rows.length) return <div className="empty-row">{empty}</div>;
  return (
    <table>
      <thead><tr>{columns.map((c, i) => <th key={i} className={c.num ? 'num' : ''}>{c.title}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={getKey ? getKey(r, ri) : (r.id ?? ri)}>
            {columns.map((c, ci) => {
              const cls = [c.num && 'num', typeof c.cls === 'function' ? c.cls(r) : c.cls].filter(Boolean).join(' ');
              return <td key={ci} className={cls}>{c.render(r)}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const nameCell = (r) => <><span className="inv">{r.inv || '—'}</span>{r.desc}</>;

export const cell = { money, int, pct };
