import { useEffect } from 'react';
import { barcodeSVG, canBarcode } from '../lib/barcode.js';
import { money, int } from '../lib/format.js';

const TAG_LIMIT = 600;

/** Printable price tags for whatever the Inventory filters currently show. */
export function PrintTags({ rows, onClose }) {
  const printable = rows.filter((r) => r.source !== 'quail' && canBarcode(r.inv));
  const skipped = rows.filter((r) => r.source !== 'quail').length - printable.length;
  const tags = printable.slice(0, TAG_LIMIT);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const notes = [];
  if (tags.length < printable.length) notes.push(`showing the first ${int(TAG_LIMIT)}`);
  if (skipped) notes.push(`${int(skipped)} without a usable number skipped`);

  return (
    <section id="print-tags" className="sheet">
      <div className="sheet-head no-print">
        <div>
          <h2>Print tags</h2>
          <p className="sheet-sub">{tags.length
            ? `${int(tags.length)} tag${tags.length === 1 ? '' : 's'} from the current view${notes.length ? ' · ' + notes.join(' · ') : ''}.`
            : 'No taggable items in the current view.'}</p>
        </div>
        <div className="sheet-actions">
          <button className="btn primary" disabled={!tags.length} onClick={() => window.print()}>Print</button>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="tag-grid">
        {tags.map((r) => (
          <div className="tag" key={r.id}>
            <div className="tag-desc">{r.desc}</div>
            <div className="tag-price">{r.ask > 0 ? money(r.ask) : ' '}</div>
            <span dangerouslySetInnerHTML={{ __html: barcodeSVG(String(r.inv)) }} />
            <div className="tag-inv">{r.inv}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
