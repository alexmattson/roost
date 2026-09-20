import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../store/data.jsx';
import { barcodeSVG, canBarcode } from '../lib/barcode.js';
import { money, int } from '../lib/format.js';
import {
  SHEET_TEMPLATES, LABEL_TEMPLATES, PX_PER,
  findSheet, findLabel, paginate, pageSize, defaultVendor
} from '../lib/labels.js';

const TAG_LIMIT = 600;
const VENDOR_KEY = 'roost_tag_vendor';

// A barcode is deterministic for a value, so cache the SVG — the whole preview
// re-renders on every toggle/keystroke and there can be hundreds of tags.
const bcCache = new Map();
function bc(inv) {
  let svg = bcCache.get(inv);
  if (!svg) { svg = barcodeSVG(String(inv)); bcCache.set(inv, svg); }
  return svg;
}

/**
 * The label-printing workspace: pick a printer type and stock, tune what shows
 * on each tag, preview the actual sheet, and print (or, for a code list,
 * download the barcode data). It mirrors the variants Sandpiper supports.
 */
export function PrintTags({ rows, onClose }) {
  const { meta } = useData();

  const printable = useMemo(
    () => rows.filter((r) => r.source !== 'quail' && canBarcode(r.inv)),
    [rows]
  );
  const skipped = rows.filter((r) => r.source !== 'quail').length - printable.length;
  const tags = useMemo(() => printable.slice(0, TAG_LIMIT), [printable]);

  const [printer, setPrinter] = useState('sheet');       // sheet | label | codelist
  const [family, setFamily] = useState('letter');        // letter | a4
  const [sheetId, setSheetId] = useState('us-2.625x1');
  const [labelId, setLabelId] = useState('lp-2x1');
  const [show, setShow] = useState({ price: true, desc: true, vendor: true, inv: true });
  const [vendor, setVendor] = useState(() => {
    try { const v = localStorage.getItem(VENDOR_KEY); if (v != null) return v; } catch { /* ignore */ }
    return defaultVendor(meta && meta.user);
  });

  useEffect(() => { try { localStorage.setItem(VENDOR_KEY, vendor); } catch { /* ignore */ } }, [vendor]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sheetT = findSheet(family, sheetId);
  const labelT = findLabel(labelId);
  const activeT = printer === 'label' ? labelT : sheetT;

  const notes = [];
  if (tags.length < printable.length) notes.push(`showing the first ${int(TAG_LIMIT)}`);
  if (skipped) notes.push(`${int(skipped)} without a usable number skipped`);

  const canPrint = tags.length > 0 && printer !== 'codelist';
  const summary = tags.length
    ? `${int(tags.length)} tag${tags.length === 1 ? '' : 's'} from the current view${notes.length ? ' · ' + notes.join(' · ') : ''}.`
    : 'No taggable items in the current view.';

  return (
    <section id="print-tags" className="sheet">
      <div className="sheet-head no-print">
        <div>
          <h2>Print tags</h2>
          <p className="sheet-sub">{summary}</p>
        </div>
        <div className="sheet-actions">
          {printer === 'codelist'
            ? <button className="btn primary" disabled={!tags.length} onClick={() => downloadCodes(tags, show, vendor)}>Download file</button>
            : <button className="btn primary" disabled={!canPrint} onClick={() => window.print()}>Print</button>}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="tagx-body">
        <aside className="tagx-panel no-print">
          <PrinterTypePicker value={printer} onChange={setPrinter} />

          {printer === 'sheet' && (
            <SheetPicker family={family} setFamily={setFamily} sheetId={sheetId} setSheetId={setSheetId} />
          )}
          {printer === 'label' && (
            <LabelPicker labelId={labelId} setLabelId={setLabelId} />
          )}
          {printer === 'codelist' && (
            <div className="fix-bar warn tagx-warn">
              <span className="count"><b>⚠ Needs a custom printer.</b> This downloads a file of
                Quail-compatible barcode data. Use your label printer's own software to render
                the Code 128 barcodes and print them.</span>
            </div>
          )}

          {printer !== 'codelist' && (
            <ContentPicker show={show} setShow={setShow} vendor={vendor} setVendor={setVendor} />
          )}
        </aside>

        <div className="tagx-preview">
          {!tags.length ? (
            <div className="tagx-empty">Nothing to tag in the current view.</div>
          ) : printer === 'codelist' ? (
            <CodeListPreview tags={tags} show={show} vendor={vendor} />
          ) : (
            <ScaledPreview kind={printer} t={activeT} tags={tags} show={show} vendor={vendor} />
          )}
        </div>
      </div>

      {/* Live @page size for the current stock. */}
      {canPrint && <style>{`@media print { @page { size: ${pageSize(activeT, printer)}; margin: 0; } }`}</style>}
    </section>
  );
}

/* ----------------------------------------------------------------- pickers */

function PrinterTypePicker({ value, onChange }) {
  const opts = [
    { id: 'sheet', name: 'Sheet', hint: 'Address-label sheets on a desktop printer', art: <ArtSheet /> },
    { id: 'label', name: 'Label', hint: 'One tag per label on a dedicated printer', art: <ArtLabel /> },
    { id: 'codelist', name: 'Code list', hint: 'A data file for your printer software', art: <ArtCodeList /> }
  ];
  return (
    <div className="tagx-group">
      <h3>Printer type</h3>
      <div className="tagx-cards">
        {opts.map((o) => (
          <button key={o.id} className={`tagx-card ${value === o.id ? 'on' : ''}`} onClick={() => onChange(o.id)}>
            <span className="tagx-card-art">{o.art}</span>
            <span className="tagx-card-name">{o.name}</span>
            <span className="tagx-card-hint">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SheetPicker({ family, setFamily, sheetId, setSheetId }) {
  const list = SHEET_TEMPLATES[family];
  useEffect(() => { if (!list.some((t) => t.id === sheetId)) setSheetId(list[0].id); }, [family]); // eslint-disable-line
  return (
    <div className="tagx-group">
      <h3>Label template
        <span className="tagx-seg">
          <button className={family === 'letter' ? 'on' : ''} onClick={() => setFamily('letter')}>US Letter</button>
          <button className={family === 'a4' ? 'on' : ''} onClick={() => setFamily('a4')}>A4</button>
        </span>
      </h3>
      <div className="tagx-sizes">
        {list.map((t) => (
          <button key={t.id} className={`tagx-size ${sheetId === t.id ? 'on' : ''}`} onClick={() => setSheetId(t.id)}>
            <SizeGlyph cols={t.cols} rows={t.rows} />
            <span className="tagx-size-name">{t.name}</span>
            <span className="tagx-size-sub">{t.per} / sheet</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LabelPicker({ labelId, setLabelId }) {
  return (
    <div className="tagx-group">
      <h3>Paper size</h3>
      <div className="tagx-sizes">
        {LABEL_TEMPLATES.map((t) => (
          <button key={t.id} className={`tagx-size ${labelId === t.id ? 'on' : ''}`} onClick={() => setLabelId(t.id)}>
            <SizeGlyph single />
            <span className="tagx-size-name">{t.name}</span>
            <span className="tagx-size-sub">{t.note || 'label printer'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ContentPicker({ show, setShow, vendor, setVendor }) {
  const toggle = (k) => setShow({ ...show, [k]: !show[k] });
  const items = [['price', 'Price'], ['desc', 'Description'], ['vendor', 'Vendor code'], ['inv', 'Number']];
  return (
    <div className="tagx-group">
      <h3>On each tag</h3>
      <div className="tagx-toggles">
        {items.map(([k, label]) => (
          <label key={k} className="tagx-check">
            <input type="checkbox" checked={show[k]} onChange={() => toggle(k)} /> {label}
          </label>
        ))}
      </div>
      {show.vendor && (
        <label className="tagx-field">
          <span>Vendor code</span>
          <input value={vendor} maxLength={6} placeholder="e.g. AGM"
            onChange={(e) => setVendor(e.target.value.toUpperCase())} />
        </label>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- preview */

/** Scales one true-size sheet/label render down to fit the preview column. */
function ScaledPreview({ kind, t, tags, show, vendor }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  const px = PX_PER[t.unit];
  const pageWpx = kind === 'sheet' ? t.page.w * px : t.w * px;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const avail = el.clientWidth - 8;
      // Sheets scale down to fit; small labels zoom up so they stay legible.
      const s = kind === 'sheet'
        ? Math.min(1, avail / pageWpx)
        : Math.min(3, Math.max(1.4, 260 / pageWpx));
      setScale(s > 0 ? s : 1);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [kind, pageWpx]);

  const content = kind === 'sheet'
    ? paginate(tags, t.per).map((page, i) => (
        <SheetPage key={i} t={t} tags={page} show={show} vendor={vendor} />
      ))
    : tags.map((r) => <LabelPage key={r.id} t={t} r={r} show={show} vendor={vendor} />);

  return (
    <div className="tagx-scale-wrap" ref={wrapRef}>
      <div id="print-out" className={`tagx-pages ${kind}`} style={{ '--scale': scale }}>
        {content}
      </div>
    </div>
  );
}

function SheetPage({ t, tags, show, vendor }) {
  const u = t.unit;
  return (
    <div className="tag-page" style={{
      width: `${t.page.w}${u}`, height: `${t.page.h}${u}`,
      paddingTop: `${t.margin.top}${u}`, paddingLeft: `${t.margin.left}${u}`, paddingRight: `${t.margin.left}${u}`
    }}>
      <div className="tag-page-grid" style={{
        gridTemplateColumns: `repeat(${t.cols}, ${t.cell.w}${u})`,
        columnGap: `${t.gap.x}${u}`, rowGap: `${t.gap.y}${u}`
      }}>
        {tags.map((r) => <Tagx key={r.id} r={r} unit={u} w={t.cell.w} h={t.cell.h} show={show} vendor={vendor} />)}
      </div>
    </div>
  );
}

function LabelPage({ t, r, show, vendor }) {
  return (
    <div className="label-page" style={{ width: `${t.w}${t.unit}`, height: `${t.h}${t.unit}` }}>
      <Tagx r={r} unit={t.unit} w={t.w} h={t.h} show={show} vendor={vendor} />
    </div>
  );
}

/** One tag. Sized in the template's physical unit; children scale in `em` off
 *  a font-size proportional to tag height, so one layout fits every stock. */
const Tagx = memo(function Tagx({ r, unit, w, h, show, vendor }) {
  const fs = Math.max(h * 0.13, unit === 'mm' ? 1.6 : 0.06);
  const style = { width: `${w}${unit}`, height: `${h}${unit}`, fontSize: `${fs}${unit}` };
  const priceOnly = show.price && !show.desc;
  return (
    <div className={`tagx ${priceOnly ? 'compact' : ''}`} style={style}>
      <div className="tagx-top">
        <span className="tagx-bc" dangerouslySetInnerHTML={{ __html: bc(r.inv) }} />
        {show.price && <span className="tagx-price">{r.ask > 0 ? money(r.ask) : ''}</span>}
      </div>
      {show.desc && <div className="tagx-desc">{r.desc}</div>}
      {(show.vendor || show.inv) && (
        <div className="tagx-foot">
          <span>{show.vendor ? vendor : ''}</span>
          <span>{show.inv ? r.inv : ''}</span>
        </div>
      )}
    </div>
  );
});

function CodeListPreview({ tags }) {
  const head = tags.slice(0, 40);
  return (
    <div className="tagx-codelist">
      <div className="tagx-codelist-head">
        <span>Barcode</span><span>Description</span><span className="num">Price</span>
      </div>
      {head.map((r) => (
        <div className="tagx-codelist-row" key={r.id}>
          <span className="mono">{r.inv}</span>
          <span className="ell">{r.desc}</span>
          <span className="num">{r.ask > 0 ? money(r.ask) : '—'}</span>
        </div>
      ))}
      {tags.length > head.length && (
        <div className="tagx-codelist-more">+ {int(tags.length - head.length)} more in the file</div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- glyph art */

function SizeGlyph({ cols = 1, rows = 1, single = false }) {
  if (single) return (
    <span className="tagx-glyph single"><span className="tagx-glyph-cell" /></span>
  );
  const c = Math.min(cols, 6);
  const r = Math.min(rows, 6);
  return (
    <span className="tagx-glyph" style={{ gridTemplateColumns: `repeat(${c}, 1fr)`, gridTemplateRows: `repeat(${r}, 1fr)` }}>
      {Array.from({ length: c * r }, (_, i) => <span key={i} className="tagx-glyph-cell" />)}
    </span>
  );
}

const ArtSheet = () => (
  <svg viewBox="0 0 36 44" className="tagx-art"><rect x="3" y="2" width="30" height="40" rx="2" />
    {[0, 1, 2, 3, 4, 5].map((r) => [0, 1, 2].map((c) => (
      <rect key={`${r}${c}`} x={6 + c * 8.7} y={5 + r * 6} width="7.4" height="4.6" rx="1" className="cut" />
    )))}</svg>
);
const ArtLabel = () => (
  <svg viewBox="0 0 36 44" className="tagx-art"><rect x="3" y="2" width="30" height="40" rx="2" />
    {[6, 13, 20, 27, 34].map((y) => <rect key={y} x="8" y={y} width="20" height="4" rx="1" className="cut" />)}</svg>
);
const ArtCodeList = () => (
  <svg viewBox="0 0 36 44" className="tagx-art"><rect x="3" y="2" width="30" height="40" rx="2" />
    {[6, 11, 16, 21, 26, 31, 36].map((y, i) => (
      <rect key={y} x="7" y={y} width={22 - (i % 3) * 6} height="2.6" rx="1" className="cut" />
    ))}</svg>
);

/* --------------------------------------------------------------- download */

function downloadCodes(tags, show, vendor) {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['barcode', 'description', 'price'];
  if (show.vendor) head.push('vendor');
  const lines = [head.join(',')];
  for (const r of tags) {
    const row = [r.inv, r.desc, r.ask > 0 ? (r.ask / 100).toFixed(2) : ''];
    if (show.vendor) row.push(vendor);
    lines.push(row.map(esc).join(','));
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `roost-barcodes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
