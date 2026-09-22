import { useState } from 'react';
import { Select } from '../components/Select.jsx';

/**
 * Full-screen edit sheet for a single inventory item — the mobile stand-in for
 * the desktop inline-editable row, which is unusable at phone width. Drives the
 * same `fields` / `setFields` state and the same save as the inline editor.
 */
export function EditItemSheet({ r, fields, setFields, boothOptions = [], busy, onSave, onCancel, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k) => (e) => setFields({ ...fields, [k]: e.target.value });
  const setBooth = (id) => {
    const opt = boothOptions.find((o) => o.id === id);
    setFields({ ...fields, booth: id, store: opt ? opt.storeId : '' });
  };

  const boothOpts = [
    { value: '', label: 'Unassigned' },
    ...boothOptions.map((o) => ({ value: o.id, label: `${o.label}${o.store ? ` · ${o.store}` : ''}` }))
  ];

  return (
    <section className="sheet edit-sheet">
      <div className="sheet-head">
        <div>
          <h2>Edit #{fields.inv || '—'}</h2>
          <p className="sheet-sub">{r.desc}</p>
        </div>
        <div className="sheet-actions">
          <button className="btn ghost" onClick={onCancel}>Close</button>
        </div>
      </div>

      <div className="ef-body">
        <label className="ef-field"><span>Inventory #</span>
          <input value={fields.inv} onChange={set('inv')} aria-label="Inventory number" /></label>

        <label className="ef-field"><span>Description</span>
          <input value={fields.desc} onChange={set('desc')} aria-label="Description" /></label>

        <div className="ef-field"><span>Category</span>
          <div className="ef-static">{r.category || '—'}</div></div>

        {boothOptions.length > 0 && (
          <div className="ef-field"><span>Booth / channel</span>
            <Select className="ef-select" ariaLabel="Booth / channel"
              value={fields.booth || ''} onChange={setBooth} options={boothOpts} /></div>
        )}

        <label className="ef-field"><span>Acquired</span>
          <input type="date" value={fields.acquired} onChange={set('acquired')} aria-label="Acquired date" /></label>

        <div className="ef-row">
          <label className="ef-field"><span>Cost</span>
            <span className="ef-money"><i>$</i><input inputMode="decimal" value={fields.cost} onChange={set('cost')} aria-label="Cost" /></span></label>
          <label className="ef-field"><span>Asking price</span>
            <span className="ef-money"><i>$</i><input inputMode="decimal" value={fields.ask} onChange={set('ask')} aria-label="Asking price" /></span></label>
        </div>

        <div className="ef-sold">
          <div className="ef-sold-head">Sold {r.isSold ? '' : '· enter a date to mark it sold'}</div>
          <div className="ef-row">
            <label className="ef-field"><span>Sold date</span>
              <input type="date" value={fields.sold} onChange={set('sold')} aria-label="Sold date" /></label>
            <label className="ef-field"><span>Sold price</span>
              <span className="ef-money"><i>$</i><input inputMode="decimal" value={fields.soldPrice} onChange={set('soldPrice')} aria-label="Sold price" /></span></label>
          </div>
        </div>

        {confirmDel ? (
          <div className="ef-del-confirm">
            <span>Delete this item from Sandpiper? This can't be undone.</span>
            <div className="ef-del-acts">
              <button className="btn ghost" onClick={() => setConfirmDel(false)}>Keep</button>
              <button className="btn danger" disabled={busy} onClick={onDelete}>Delete</button>
            </div>
          </div>
        ) : (
          <button className="ef-delete" onClick={() => setConfirmDel(true)}>Delete item</button>
        )}
      </div>

      <div className="sheet-foot">
        <span className="sheet-totals">{r.isSold ? 'Sold' : 'On hand'}</span>
        <div className="sheet-actions">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </section>
  );
}
