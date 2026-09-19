import { useMemo, useState, useEffect } from 'react';
import { useData } from '../store/data.jsx';
import { useNav } from '../store/nav.jsx';
import { takenNumbers, numberKey } from '../lib/stock.js';
import { ITEM_COLUMNS, ITEM_ACTS_W, filterItems, collectChanges, editFields } from '../lib/items.js';
import { Card, Button } from '../components/ui.jsx';
import { SortableTable } from '../components/SortableTable.jsx';
import { PrintTags } from './PrintTags.jsx';

const FILTERS = [
  ['all', 'All items'], ['onhand', 'Unsold only'], ['sold', 'Sold only'], ['loss', 'Sold at a loss'],
  ['noprice', 'Missing asking price'], ['zerocost', 'No cost recorded'], ['aged', 'Held over 180 days'], ['nobarcode', 'No barcode yet']
];

export function Inventory() {
  const { items, applyEdits, deleteItems } = useData();
  const { range, inventoryFilter, setInventoryFilter, openAddStock } = useNav();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(inventoryFilter || 'all');
  const [editingId, setEditingId] = useState(null);
  const [fields, setFields] = useState(null);
  const [deletePending, setDeletePending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);
  const [showPrint, setShowPrint] = useState(false);

  useEffect(() => { if (inventoryFilter) setFilter(inventoryFilter); }, [inventoryFilter]);

  const rows = useMemo(
    () => filterItems(items, { start: range.start, end: range.end, filter, search }),
    [items, range, filter, search]
  );

  const flash = (kind, text, ms = 2600) => { setBanner({ kind, text }); if (ms) setTimeout(() => setBanner(null), ms); };
  const startEdit = (r) => { setEditingId(r.id); setFields(editFields(r)); };
  const cancelEdit = () => { setEditingId(null); setFields(null); };

  const rowClick = (r, e) => {
    if (e.target.closest('button, input, select, a')) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    if (editingId && editingId !== r.id) {
      const open = items.find((x) => x.id === editingId);
      if (open && collectChanges(open, fields).length) { flash('info', 'Save or cancel your changes first.', 2400); return; }
    }
    startEdit(r);
  };

  const save = async (r) => {
    const changes = collectChanges(r, fields);
    if (!changes.length) return cancelEdit();
    const inv = String(fields.inv || '').trim();
    if (!inv) return flash('error', 'An item needs an inventory number.');
    const clash = takenNumbers(items.filter((i) => i.id !== r.id)).get(numberKey(inv));
    if (clash) return flash('error', `#${inv} is already "${clash.desc}".`);
    setBusy(true);
    try {
      const res = await applyEdits([{ itemId: r.id, changes }]);
      const bad = res.results.find((x) => !x.ok);
      if (bad) throw new Error(bad.error);
      cancelEdit();
      flash('ok', `Updated #${inv}.`);
    } catch (e) { flash('error', e.message, 0); }
    finally { setBusy(false); }
  };

  const doDelete = async (ids) => {
    setBusy(true);
    try {
      const res = await deleteItems(ids);
      const failed = res.results.find((r) => !r.ok);
      setDeletePending(null);
      flash(failed ? 'error' : 'ok',
        failed ? `Deleted ${res.deleted} of ${ids.length}, then stopped: ${failed.error}` : `Deleted ${res.deleted} item${res.deleted === 1 ? '' : 's'}.`,
        failed ? 0 : 2800);
    } catch (e) { flash('error', e.message, 0); }
    finally { setBusy(false); }
  };

  const renderRow = (r) => (editingId === r.id
    ? <EditorRow key={r.id} r={r} fields={fields} setFields={setFields} onSave={() => save(r)} onCancel={cancelEdit} />
    : <ItemRow key={r.id} r={r} onClick={(e) => rowClick(r, e)} onDelete={() => setDeletePending([r.id])} />);

  return (
    <Card className="records-card">
      <div className="card-head">
        <h2>Inventory</h2>
        <span className="hint source">Sandpiper records, as Sandpiper holds them</span>
        <div className="table-controls">
          <input type="search" placeholder="Search description or #…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={filter} onChange={(e) => { setFilter(e.target.value); setInventoryFilter(e.target.value); }}>
            {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <Button small onClick={() => setShowPrint(true)}>Print tags</Button>
          <Button small onClick={openAddStock}>+ Add stock</Button>
        </div>
      </div>

      {banner && <div className={`banner ${banner.kind}`}><span>{banner.text}</span></div>}
      <DeleteBar pending={deletePending} busy={busy} items={items}
        onCancel={() => setDeletePending(null)} onGo={() => doDelete(deletePending)} />

      <div className="table-scroll">
        <SortableTable
          columns={ITEM_COLUMNS} rows={rows} fixed actsWidth={ITEM_ACTS_W}
          initialSort={{ key: 'acquired', dir: -1 }} limit={400}
          trailingHeader={<th className="row-acts" />} renderRow={renderRow}
          empty="No items match those filters" />
      </div>

      {showPrint && <PrintTags rows={rows} onClose={() => setShowPrint(false)} />}
    </Card>
  );
}

function ItemRow({ r, onClick, onDelete }) {
  return (
    <tr className="editable" title="Click to edit" onClick={onClick}>
      {ITEM_COLUMNS.map((c) => {
        const cls = [c.num && 'num', typeof c.cls === 'function' ? c.cls(r) : c.cls].filter(Boolean).join(' ');
        const content = c.render(r);
        return <td key={c.key} className={cls}>{content == null && c.key === 'soldPrice' ? <span className="pill hold">on hand</span> : content}</td>;
      })}
      <td className="row-acts"><button className="row-act act-del" title="Delete this item" onClick={onDelete}>Delete</button></td>
    </tr>
  );
}

function EditorRow({ r, fields, setFields, onSave, onCancel }) {
  const set = (k) => (e) => setFields({ ...fields, [k]: e.target.value });
  return (
    <tr className="editing">
      <td><input className="e-inv" value={fields.inv} onChange={set('inv')} aria-label="Inventory number" /></td>
      <td><input className="e-desc" autoFocus value={fields.desc} onChange={set('desc')} aria-label="Description" /></td>
      <td className="muted">{r.category}</td>
      <td><input type="date" className="e-acquired" value={fields.acquired} onChange={set('acquired')} aria-label="Acquired date" /></td>
      <td><input className="e-cost num" value={fields.cost} onChange={set('cost')} inputMode="decimal" aria-label="Cost" /></td>
      <td><input className="e-ask num" value={fields.ask} onChange={set('ask')} inputMode="decimal" aria-label="Asking price" /></td>
      <td><input type="date" className="e-sold" value={fields.sold} onChange={set('sold')} disabled={!r.isSold} aria-label="Sold date" /></td>
      <td><input className="e-soldPrice num" value={fields.soldPrice} onChange={set('soldPrice')} disabled={!r.isSold} inputMode="decimal" aria-label="Sold price" /></td>
      <td colSpan={4} className="row-acts">
        <button className="row-act act-save" onClick={onSave}>Save</button>
        <button className="row-act act-cancel" onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  );
}

function DeleteBar({ pending, busy, items, onCancel, onGo }) {
  if (!pending || !pending.length) return null;
  const named = pending.map((id) => items.find((r) => r.id === id)).filter(Boolean).map((r) => `#${r.inv || '—'} ${r.desc}`);
  return (
    <div className="fix-bar">
      <span className="count">Delete <b>{named.join(', ')}</b> from Sandpiper? This cannot be undone.</span>
      <button className="fix-btn" onClick={onCancel}>Cancel</button>
      <button className="fix-btn danger" disabled={busy} onClick={onGo}>{busy ? 'Deleting…' : 'Delete'}</button>
    </div>
  );
}
