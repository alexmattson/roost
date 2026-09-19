import { useMemo, useState, useEffect, useRef } from 'react';
import { useData } from '../store/data.jsx';
import { analyze, dataBounds } from '../lib/analytics.js';
import {
  nextInventoryNumber, blankRow, isRowEmpty, validateRow, draftNumberCounts,
  takenNumbers, priceHistory, margin, splitLotCost, buildCreatePayload, draftTotals
} from '../lib/stock.js';
import { money, int } from '../lib/format.js';

const DRAFT_KEY = 'roost_stock_draft';
const centsFrom = (t) => { const raw = String(t == null ? '' : t).replace(/[^0-9.]/g, ''); if (!raw) return null; const n = Number(raw); return Number.isFinite(n) ? Math.round(n * 100) : null; };
const centsTo = (c) => (c == null ? '' : (c / 100).toFixed(2));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

export function AddStock({ onClose }) {
  const { items, createItems } = useData();
  const commissionRate = useMemo(() => {
    const b = dataBounds(items);
    const s = analyze(items, { start: b.min, end: Math.max(Date.now(), b.max) });
    return (s.inventory && s.inventory.commissionRate) || 0.15;
  }, [items]);

  const [acquired, setAcquired] = useState(todayISO());
  const [lotCents, setLotCents] = useState(null);
  const [rows, setRows] = useState(() => loadDraft() || [blankRow(nextInventoryNumber(items))]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);
  const draftTimer = useRef(0);

  const taken = useMemo(() => takenNumbers(items), [items]);

  // Persist a draft of non-empty rows.
  useEffect(() => {
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      const keep = rows.filter((r) => !isRowEmpty(r));
      try {
        if (keep.length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ acquired, rows: keep }));
        else localStorage.removeItem(DRAFT_KEY);
      } catch (e) { /* ignore */ }
    }, 400);
    return () => clearTimeout(draftTimer.current);
  }, [rows, acquired]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nextDraftNumber = () => {
    const now = Math.floor(Date.now() / 1000);
    const drafts = rows.filter((r) => String(r.inv || '').trim()).map((r) => ({ inv: r.inv, acquired: now }));
    return nextInventoryNumber([...items, ...drafts]);
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow(nextDraftNumberFrom(rs))]);
  const nextDraftNumberFrom = (rs) => {
    const now = Math.floor(Date.now() / 1000);
    const drafts = rs.filter((r) => String(r.inv || '').trim()).map((r) => ({ inv: r.inv, acquired: now }));
    return nextInventoryNumber([...items, ...drafts]);
  };
  const removeRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  const counts = draftNumberCounts(rows);
  const totals = draftTotals(rows, commissionRate);
  const badCount = rows.filter((r) => !isRowEmpty(r) &&
    !validateRow(r, { taken, draftCounts: counts, commissionRate }).ok).length;

  const flash = (kind, text, ms = 3000) => { setBanner({ kind, text }); if (ms) setTimeout(() => setBanner(null), ms); };

  const split = () => {
    const live = rows.filter((r) => !isRowEmpty(r));
    if (!lotCents || !live.length) return flash('error', 'Enter what the lot cost, and at least one item to spread it over.');
    const parts = splitLotCost(lotCents, live);
    let k = 0;
    setRows((rs) => rs.map((r) => (isRowEmpty(r) ? r : { ...r, costCents: parts[k++] })));
    flash('ok', `Split ${money(lotCents)} across ${int(live.length)} items.`);
  };

  const submit = async () => {
    const live = rows.filter((r) => !isRowEmpty(r));
    if (!live.length || badCount) return;
    const acq = Math.floor(new Date(`${acquired}T12:00:00`).getTime() / 1000);
    setBusy(true);
    try {
      const res = await createItems(live.map((r) => ({ item: buildCreatePayload(r, { acquired: acq }), quantity: Math.max(1, r.qty || 1) })));
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length) {
        setRows(live.filter((r) => failed.some((f) => f.inv === String(r.inv).trim())));
        flash('error', `Added ${int(res.created)}. ${failed.length} failed: ${failed[0].error}`, 0);
      } else {
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
        onClose();
      }
    } catch (e) { flash('error', e.message, 0); }
    finally { setBusy(false); }
  };

  const discard = () => {
    if (rows.some((r) => !isRowEmpty(r)) && !window.confirm('Discard everything typed here?')) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    onClose();
  };

  return (
    <section className="sheet">
      <div className="sheet-head">
        <div>
          <h2>Add stock</h2>
          <p className="sheet-sub">{items.length
            ? `Numbers continue your ${nextDraftNumber()} series. Enter moves down, and adds a row at the bottom.`
            : 'Fetch your data first so Roost can pick inventory numbers for you.'}</p>
        </div>
        <button className="icon-btn" title="Close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="sheet-defaults">
        <label className="field"><span>Acquired</span>
          <input type="date" value={acquired} onChange={(e) => setAcquired(e.target.value)} /></label>
        <label className="field"><span>Paid for the lot</span>
          <span className="money-input"><i>$</i>
            <input type="text" inputMode="decimal" placeholder="0.00" value={centsTo(lotCents)}
              onChange={(e) => setLotCents(centsFrom(e.target.value))} /></span></label>
        <button className="btn small" onClick={split}>Split across rows</button>
        <p className="sheet-note">Spreads one price over everything below, weighted by asking price.</p>
      </div>

      {banner && <div className={`banner ${banner.kind}`} style={{ margin: '0 18px' }}><span>{banner.text}</span></div>}

      <div className="stock-grid">
        {rows.length === 0
          ? <p className="stock-empty">No rows. Add one to start entering stock.</p>
          : (
            <div className="stock-head">
              <span className="num">Inv #</span><span>Description</span>
              <span className="cost">Cost</span><span className="ask">Asking</span>
              <span className="qty">Qty</span><span className="nets">You keep</span><span />
            </div>
          )}
        {rows.map((row, i) => (
          <StockRow key={i} row={row} idx={i} items={items} taken={taken} counts={counts} rate={commissionRate}
            onChange={(patch) => setRow(i, patch)} onRemove={() => removeRow(i)}
            onEnter={() => { if (i === rows.length - 1) addRow(); }} />
        ))}
        <button className="stock-add" onClick={addRow}>+ Add {rows.length ? 'row' : 'a row'}</button>
      </div>

      <div className="sheet-foot">
        <div className="sheet-totals">{totals.rows
          ? <>{'​'}<b>{int(totals.items)}</b> item{totals.items === 1 ? '' : 's'} · cost <b>{money(totals.cost)}</b> · asking <b>{money(totals.ask)}</b> · you keep <b>{money(totals.net)}</b>
              {badCount > 0 && <span style={{ color: 'var(--red)' }}> · {int(badCount)} need{badCount === 1 ? 's' : ''} fixing</span>}</>
          : 'Nothing to add yet.'}</div>
        <div className="sheet-actions">
          <button className="btn ghost" onClick={discard}>Discard</button>
          <button className="btn primary" disabled={busy || !totals.rows || badCount > 0} onClick={submit}>
            {busy ? 'Adding…' : totals.rows ? `Add ${int(totals.items)} item${totals.items === 1 ? '' : 's'}` : 'Add items'}
          </button>
        </div>
      </div>
    </section>
  );
}

function StockRow({ row, idx, items, taken, counts, rate, onChange, onRemove, onEnter }) {
  const empty = isRowEmpty(row);
  const v = empty ? { errors: [], warnings: [], ok: true } : validateRow(row, { taken, draftCounts: counts, commissionRate: rate });
  const hint = (!empty && !v.errors.length && !v.warnings.length && row.desc.trim().length > 3)
    ? priceHistory(row.desc, items) : null;
  const nets = row.askCents > 0 ? margin(row.askCents, row.costCents || 0, rate) : null;
  const numBad = v.errors.some((e) => e.includes('#'));

  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } };

  return (
    <div className="stock-row" data-i={idx}>
      <input className={`num ${numBad ? 'bad' : ''}`} value={row.inv} aria-label="Inventory number" spellCheck={false}
        onChange={(e) => onChange({ inv: e.target.value.trim() })} onKeyDown={onKey} />
      <input className="desc" value={row.desc} placeholder="What is it?" aria-label="Description"
        onChange={(e) => onChange({ desc: e.target.value })} onKeyDown={onKey} />
      <input className="cost" value={centsTo(row.costCents)} inputMode="decimal" placeholder="0.00" aria-label="Cost"
        onChange={(e) => onChange({ costCents: centsFrom(e.target.value) })} onKeyDown={onKey} />
      <input className="ask" value={centsTo(row.askCents)} inputMode="decimal" placeholder="0.00" aria-label="Asking price"
        onChange={(e) => onChange({ askCents: centsFrom(e.target.value) })} onKeyDown={onKey} />
      <input className="qty" value={row.qty || 1} inputMode="numeric" aria-label="Quantity"
        onChange={(e) => onChange({ qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} onKeyDown={onKey} />
      <span className={`stock-nets ${nets && nets.profit < 0 ? 'loss' : ''}`}>
        {nets && <><b>{money(nets.net)}</b><br />{nets.profit >= 0 ? '+' : ''}{money(nets.profit)}</>}
      </span>
      <button className="row-drop" title="Remove this row" aria-label="Remove row" onClick={onRemove}>×</button>
      <div className={`row-note ${v.errors.length ? 'err' : v.warnings.length ? 'warn' : hint ? 'hint' : ''}`}>
        {v.errors.length ? v.errors[0]
          : v.warnings.length ? v.warnings[0]
          : (hint && hint.soldMedian)
            ? <>{hint.basis === 'similar items' ? 'Similar' : `Your ${hint.basis}`} sold for <b>{money(hint.soldMedian)}</b>
                {hint.daysMedian != null && <>, took <b>{int(Math.round(hint.daysMedian))} days</b></>} <span className="hint">({int(hint.n)})</span></>
            : ''}
      </div>
    </div>
  );
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d && Array.isArray(d.rows) && d.rows.length) return d.rows;
  } catch (e) { /* ignore */ }
  return null;
}
