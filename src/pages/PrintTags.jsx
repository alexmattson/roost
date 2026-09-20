import { useEffect, useMemo, useState } from 'react';
import { useData } from '../store/data.jsx';
import { int } from '../lib/format.js';
import {
  SHEET_TEMPLATES, LABEL_TEMPLATES, findSheet, findLabel, defaultVendor
} from '../lib/labels.js';

const VENDOR_KEY = 'roost_tag_vendor';
const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD'];

/**
 * Price-tag printing. Sandpiper renders the file: we pick a stock and options,
 * POST the item ids, and open the PDF it returns — so the tags come out exactly
 * like Sandpiper's own, with no client-side barcode drawing to keep in sync.
 */
export function PrintTags({ rows, onClose }) {
  const { meta, printBarcodes } = useData();

  const ids = useMemo(
    () => rows.filter((r) => r.source !== 'quail' && r.id).map((r) => r.id),
    [rows]
  );

  const [printer, setPrinter] = useState('sheet');   // sheet | label
  const [family, setFamily] = useState('letter');    // letter | a4
  const [sheetId, setSheetId] = useState('us-2.625x1');
  const [labelId, setLabelId] = useState('lp-2x1');
  const [vendor, setVendor] = useState(() => {
    try { const v = localStorage.getItem(VENDOR_KEY); if (v != null) return v; } catch { /* ignore */ }
    return defaultVendor(meta && meta.user);
  });
  const [currency, setCurrency] = useState('USD');
  const [skip, setSkip] = useState(0);
  const [printAll, setPrintAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { try { localStorage.setItem(VENDOR_KEY, vendor); } catch { /* ignore */ } }, [vendor]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const template = printer === 'label' ? findLabel(labelId) : findSheet(family, sheetId);
  const canPrint = !busy && (printAll || ids.length > 0);

  const doPrint = async () => {
    if (!canPrint) return;
    setError(null);
    setBusy(true);
    // Reserve the tab under the click, so the async fetch doesn't trip the
    // popup blocker.
    const win = window.open('', '_blank');
    try {
      const { blob } = await printBarcodes({
        ids: printAll ? [] : ids,
        template: template.template,
        pageSize: template.pageSize,
        boothNumber: vendor.trim(),
        currency,
        skip: printer === 'sheet' ? Number(skip) || 0 : 0,
        printAll
      });
      const url = URL.createObjectURL(blob);
      if (win && !win.closed) win.location = url;
      else {
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      if (win && !win.closed) win.close();
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const subtitle = printAll
    ? 'Every item in the account.'
    : `${int(ids.length)} item${ids.length === 1 ? '' : 's'} from the current view.`;

  return (
    <section id="print-tags" className="sheet">
      <div className="sheet-head">
        <div>
          <h2>Print tags</h2>
          <p className="sheet-sub">{subtitle} Sandpiper renders the print file.</p>
        </div>
        <div className="sheet-actions">
          <button className="btn primary" disabled={!canPrint} onClick={doPrint}>
            {busy ? 'Preparing…' : 'Print'}
          </button>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </div>

      <div className="tagx-config">
        {error && <div className="banner error"><span>{error}</span></div>}

        <PrinterTypePicker value={printer} onChange={setPrinter} />

        {printer === 'sheet'
          ? <SheetPicker family={family} setFamily={setFamily} sheetId={sheetId} setSheetId={setSheetId} />
          : <LabelPicker labelId={labelId} setLabelId={setLabelId} />}

        <div className="tagx-group">
          <h3>Details</h3>
          <div className="tagx-fields">
            <label className="tagx-field">
              <span>Vendor code</span>
              <input value={vendor} maxLength={6} placeholder="AGM"
                onChange={(e) => setVendor(e.target.value.toUpperCase())} />
            </label>
            <label className="tagx-field">
              <span>Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {printer === 'sheet' && (
              <label className="tagx-field">
                <span>Skip labels</span>
                <input type="number" min="0" value={skip}
                  onChange={(e) => setSkip(Math.max(0, parseInt(e.target.value || '0', 10)))} />
              </label>
            )}
          </div>
          {printer === 'sheet' && (
            <p className="tagx-hint">Skip fills a partly-used sheet — it leaves that many labels blank before the first tag.</p>
          )}
          <label className="tagx-check big">
            <input type="checkbox" checked={printAll} onChange={(e) => setPrintAll(e.target.checked)} />
            Print every item in the account (ignore the current view)
          </label>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- pickers */

function PrinterTypePicker({ value, onChange }) {
  const opts = [
    { id: 'sheet', name: 'Sheet', hint: 'Address-label sheets on a desktop printer', art: <ArtSheet /> },
    { id: 'label', name: 'Label', hint: 'One tag per label on a dedicated printer', art: <ArtLabel /> }
  ];
  return (
    <div className="tagx-group">
      <h3>Printer type</h3>
      <div className="tagx-cards two">
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
            <span className="tagx-size-name">{t.name}</span>
            <span className="tagx-size-sub">{t.note || 'label printer'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- glyph art */

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
