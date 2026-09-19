import { useState, useMemo } from 'react';

/**
 * One table both Records pages share, so they look and behave the same:
 * click-to-sort headers with a direction arrow, an optional fixed column
 * layout, an optional trailing actions column, and a row cap with an overflow
 * note. Rows render through `renderRow` when a page needs custom rows (the
 * Inventory editor); otherwise cells come from each column's `render`.
 *
 * A column is { key, title, num, cls, width, render(row), sortValue(row) }.
 * Sorting is by `sortValue` (or row[key]) — numbers and strings, nulls last.
 */
export function SortableTable({
  columns, rows, initialSort, fixed = false, actsWidth = 0,
  trailingHeader = null, renderRow, limit, empty = 'Nothing here yet'
}) {
  const [sort, setSort] = useState(initialSort || { key: columns[0].key, dir: -1 });

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    const val = col && col.sortValue ? col.sortValue : (r) => r[sort.key];
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * sort.dir;
      return (av - bv) * sort.dir;
    });
  }, [rows, sort, columns]);

  const shown = limit ? sorted.slice(0, limit) : sorted;
  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }));

  if (!rows.length) return <div className="empty-row">{empty}</div>;

  return (
    <>
      <table className={fixed ? 'items-table' : ''}>
        {fixed && (
          <colgroup>
            {columns.map((c) => <col key={c.key} style={{ width: `${c.width}%` }} />)}
            {actsWidth > 0 && <col style={{ width: `${actsWidth}%` }} />}
          </colgroup>
        )}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`sortable ${c.num ? 'num' : ''}`} onClick={() => sortBy(c.key)}>
                {c.title}{sort.key === c.key && <span className="arrow"> {sort.dir > 0 ? '▲' : '▼'}</span>}
              </th>
            ))}
            {trailingHeader}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (renderRow
            ? renderRow(r)
            : (
              <tr key={r.id}>
                {columns.map((c) => {
                  const cls = [c.num && 'num', typeof c.cls === 'function' ? c.cls(r) : c.cls].filter(Boolean).join(' ');
                  return <td key={c.key} className={cls}>{c.render(r)}</td>;
                })}
              </tr>
            )))}
        </tbody>
      </table>
      {limit && sorted.length > shown.length && (
        <div className="empty-row">Showing first {shown.length} of {sorted.length}</div>
      )}
    </>
  );
}
