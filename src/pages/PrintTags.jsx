import { useEffect, useMemo, useState } from 'react';
import { useData } from '../store/data.jsx';
import { useToast } from '../store/toast.jsx';
import { useNav } from '../store/nav.jsx';
import { int } from '../lib/format.js';
import { makeVenueLabels } from '../lib/venues.js';
import { UNASSIGNED } from '../lib/analytics.js';
import {
  SHEET_TEMPLATES, LABEL_TEMPLATES, DEFAULT_SHEET_KEY,
  findSheet, findLabel
} from '../lib/labels.js';

const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD'];

/**
 * Price-tag printing. Sandpiper renders the file: we pick a stock and options,
 * POST the item ids, and open the PDF it returns — so the tags come out exactly
 * like Sandpiper's own. The payload shape mirrors Sandpiper's barcode UI:
 *   template : always a sheet key (defaults to 30up for Label / Code List).
 *   pageSize : the label size, sent only in Label mode.
 *   printAll : true only for Code List.
 */
export function PrintTags({ rows, onClose }) {
  const { printBarcodes, venueInfo, venueNames } = useData();
  const { venue } = useNav();
  const toast = useToast();

  const ids = useMemo(
    () => rows.filter((r) => r.source !== 'quail' && r.id).map((r) => r.id),
    [rows]
  );

  // The booth line on the tag is the booth name — the same value the Venues tab
  // shows (a rename override, else Sandpiper's booth name).
  const vl = useMemo(() => makeVenueLabels(venueInfo, venueNames), [venueInfo, venueNames]);
  const booths = useMemo(
    () => Object.keys((venueInfo && venueInfo.booths) || {})
      .filter((id) => id && id !== UNASSIGNED)
      .map((id) => ({ id, name: vl.label(id, 'booth') }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [venueInfo, vl]
  );

  const [printer, setPrinter] = useState('sheet');   // sheet | label | codelist
  const [family, setFamily] = useState('letter');    // letter | a4
  const [sheetKey, setSheetKey] = useState('30up');
  const [labelKey, setLabelKey] = useState('2x1');
  const [booth, setBooth] = useState(() =>
    (venue.kind === 'booth' && venue.id && vl.label(venue.id, 'booth'))
    || (booths[0] && booths[0].name) || '');
  const [currency, setCurrency] = useState('USD');
  const [skip, setSkip] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const canPrint = !busy && ids.length > 0;

  const doPrint = async () => {
    if (!canPrint) return;
    setBusy(true);
    // Reserve the tab under the click so the async fetch doesn't trip the
    // popup blocker.
    const win = window.open('', '_blank');
    try {
      // Sandpiper always sends a sheet key as `template`; Label/Code List carry
      // the default. pageSize rides along only for Label.
      const template = printer === 'sheet' ? findSheet(family, sheetKey).key : DEFAULT_SHEET_KEY;
      const pageSize = printer === 'label' ? findLabel(labelKey).size : undefined;
      const { blob } = await printBarcodes({
        template,
        skip: printer === 'sheet' ? Number(skip) || 0 : 0,
        ids,
        boothNumber: booth.trim(),
        currency,
        printAll: printer === 'codelist',
        pageSize
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
      toast('error', e.message || String(e), 0);
    } finally {
      setBusy(false);
    }
  };

  const action = printer === 'codelist' ? 'Download' : 'Print';

  return (
    <section id="print-tags" className="sheet">
      <div className="sheet-head">
        <div>
          <h2>Print tags</h2>
          <p className="sheet-sub">
            {int(ids.length)} item{ids.length === 1 ? '' : 's'} from the current view · Sandpiper renders the file.
          </p>
        </div>
        <div className="sheet-actions">
          <button className="btn primary" disabled={!canPrint} onClick={doPrint}>
            {busy ? 'Preparing…' : action}
          </button>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </div>

      <div className="tagx-config">

        <PrinterTypePicker value={printer} onChange={setPrinter} />

        {printer === 'sheet' && (
          <SheetPicker family={family} setFamily={setFamily} sheetKey={sheetKey} setSheetKey={setSheetKey} />
        )}
        {printer === 'label' && (
          <LabelPicker labelKey={labelKey} setLabelKey={setLabelKey} />
        )}
        {printer === 'codelist' && (
          <div className="tagx-group">
            <div className="fix-bar tagx-warn">
              <span className="count"><b>⚠ Needs a custom printer.</b> This produces a file of
                Quail-compatible barcode data. Use your label printer's own software to render
                the barcodes and print them.</span>
            </div>
          </div>
        )}

        <div className="tagx-group">
          <h3>Details</h3>
          <div className="tagx-fields">
            <label className="tagx-field">
              <span>Booth</span>
              {booths.length ? (
                <select value={booth} onChange={(e) => setBooth(e.target.value)}>
                  {!booths.some((b) => b.name === booth) && booth && <option value={booth}>{booth}</option>}
                  {booths.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                </select>
              ) : (
                <input value={booth} placeholder="Booth name"
                  onChange={(e) => setBooth(e.target.value)} />
              )}
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
        </div>
      </div>
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

function SheetPicker({ family, setFamily, sheetKey, setSheetKey }) {
  const list = SHEET_TEMPLATES[family];
  useEffect(() => { if (!list.some((t) => t.key === sheetKey)) setSheetKey(list[0].key); }, [family]); // eslint-disable-line
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
          <button key={t.key} className={`tagx-size ${sheetKey === t.key ? 'on' : ''}`} onClick={() => setSheetKey(t.key)}>
            <span className="tagx-size-name">{t.name}</span>
            <span className="tagx-size-sub">{t.count} / sheet{t.warning ? ' · small' : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LabelPicker({ labelKey, setLabelKey }) {
  return (
    <div className="tagx-group">
      <h3>Paper size</h3>
      <div className="tagx-sizes">
        {LABEL_TEMPLATES.map((t) => (
          <button key={t.key} className={`tagx-size ${labelKey === t.key ? 'on' : ''}`} onClick={() => setLabelKey(t.key)}>
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
const ArtCodeList = () => (
  <svg viewBox="0 0 36 44" className="tagx-art"><rect x="3" y="2" width="30" height="40" rx="2" />
    {[6, 11, 16, 21, 26, 31, 36].map((y, i) => (
      <rect key={y} x="7" y={y} width={22 - (i % 3) * 6} height="2.6" rx="1" className="cut" />
    ))}</svg>
);
