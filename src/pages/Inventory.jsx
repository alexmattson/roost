import { useMemo, useState, useEffect, useRef } from 'react';
import { useData } from '../store/data.jsx';
import { useNav } from '../store/nav.jsx';
import { takenNumbers, numberKey } from '../lib/stock.js';
import { ITEM_COLUMNS, ITEM_ACTS_W, filterItems, collectChanges, editFields } from '../lib/items.js';
import { makeVenueLabels } from '../lib/venues.js';
import { Card, Button, SearchInput, Select } from '../components/ui.jsx';
import { SortableTable } from '../components/SortableTable.jsx';
import { PrintTags } from './PrintTags.jsx';

const FILTERS = [
  ['all', 'All items'], ['onhand', 'Unsold only'], ['sold', 'Sold only'], ['loss', 'Sold at a loss'],
  ['noprice', 'Missing asking price'], ['zerocost', 'No cost recorded'], ['aged', 'Held over 180 days'], ['nobarcode', 'No barcode yet']
];

export function Inventory() {
  const { items, applyEdits, deleteItems, venueInfo, venueNames } = useData();
  const { range, inventoryFilter, setInventoryFilter, openAddStock } = useNav();

  // Channels an item can be attributed to (Sandpiper booths + their store).
  const vl = useMemo(() => makeVenueLabels(venueInfo, venueNames), [venueInfo, venueNames]);
  const boothOptions = useMemo(() => {
    const bs = (venueInfo && venueInfo.booths) || {};
    return Object.keys(bs).map((id) => ({
      id, storeId: bs[id].storeId || '', label: vl.label(id, 'booth'),
      store: bs[id].storeId ? vl.label(bs[id].storeId, 'store') : ''
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [venueInfo, vl]);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(inventoryFilter || 'all');
  const [editingId, setEditingId] = useState(null);
  const [fields, setFields] = useState(null);
  const [deletePending, setDeletePending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);
  const [showPrint, setShowPrint] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => { if (inventoryFilter) setFilter(inventoryFilter); }, [inventoryFilter]);

  const rows = useMemo(
    () => filterItems(items, { start: range.start, end: range.end, filter, search }),
    [items, range, filter, search]
  );

  // Selection for label printing. Kept as ids so it survives filtering; the tag
  // set is whatever is ticked, or the whole current view when nothing is.
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someChecked = !allChecked && rows.some((r) => selected.has(r.id));
  const printRows = selected.size ? items.filter((r) => selected.has(r.id)) : rows;

  const toggleOne = (id) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => setSelected((prev) => {
    const n = new Set(prev);
    if (rows.every((r) => n.has(r.id))) rows.forEach((r) => n.delete(r.id));
    else rows.forEach((r) => n.add(r.id));
    return n;
  });

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

  const bulkAssign = async (value) => {
    if (!value || !selected.size) return;
    const opt = boothOptions.find((o) => o.id === value);
    const clearing = value === '__unassign__';
    const boothId = clearing ? null : value;
    const storeId = clearing ? null : (opt ? opt.storeId : null);
    const ids = [...selected];
    setBusy(true);
    try {
      const res = await applyEdits(ids.map((id) => ({ itemId: id, changes: [{ field: 'soldBooth', to: boothId }, { field: 'soldStore', to: storeId }] })));
      const bad = res.results.find((x) => !x.ok);
      setSelected(new Set());
      flash(bad ? 'error' : 'ok',
        bad ? `Assigned some, then stopped: ${bad.error}` : `Assigned ${ids.length} item${ids.length === 1 ? '' : 's'} to ${clearing ? 'Unassigned' : (opt ? opt.label : value)}.`,
        bad ? 0 : 2800);
    } catch (e) { flash('error', e.message, 0); }
    finally { setBusy(false); }
  };

  const renderRow = (r) => (editingId === r.id
    ? <EditorRow key={r.id} r={r} fields={fields} setFields={setFields} boothOptions={boothOptions} onSave={() => save(r)} onCancel={cancelEdit} />
    : <ItemRow key={r.id} r={r} checked={selected.has(r.id)} onToggle={() => toggleOne(r.id)}
        onClick={(e) => rowClick(r, e)} onDelete={() => setDeletePending([r.id])} />);

  return (
    <Card className="records-card">
      <div className="card-head">
        <h2>Inventory</h2>
        <span className="hint source">Sandpiper records, as Sandpiper holds them</span>
        <div className="table-controls">
          <SearchInput placeholder="Search description or #…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={filter} onChange={(e) => { setFilter(e.target.value); setInventoryFilter(e.target.value); }}>
            {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {selected.size > 0 && boothOptions.length > 0 && (
            <Select value="" aria-label="Assign selected to a channel"
              onChange={(e) => { bulkAssign(e.target.value); e.target.value = ''; }}>
              <option value="">Assign channel…</option>
              {boothOptions.map((o) => <option key={o.id} value={o.id}>{o.label}{o.store ? ` · ${o.store}` : ''}</option>)}
              <option value="__unassign__">Unassigned</option>
            </Select>
          )}
          <Button small onClick={() => setShowPrint(true)}>Print tags{selected.size ? ` (${selected.size})` : ''}</Button>
          <Button small onClick={openAddStock}>+ Add stock</Button>
        </div>
      </div>

      {banner && <div className={`banner ${banner.kind}`}><span>{banner.text}</span></div>}
      <DeleteBar pending={deletePending} busy={busy} items={items}
        onCancel={() => setDeletePending(null)} onGo={() => doDelete(deletePending)} />

      <div className="table-scroll">
        <SortableTable
          columns={ITEM_COLUMNS} rows={rows} fixed actsWidth={ITEM_ACTS_W} leadWidth={4}
          initialSort={{ key: 'acquired', dir: -1 }} limit={400}
          leadingHeader={<th className="pick"><SelectAll checked={allChecked} indeterminate={someChecked} onChange={toggleAll} /></th>}
          trailingHeader={<th className="row-acts" />} renderRow={renderRow}
          empty="No items match those filters" />
      </div>

      {showPrint && <PrintTags rows={printRows} onClose={() => setShowPrint(false)} />}
    </Card>
  );
}

function SelectAll({ checked, indeterminate, onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label="Select all shown items" />;
}

function ItemRow({ r, checked, onToggle, onClick, onDelete }) {
  return (
    <tr className={`editable${checked ? ' picked' : ''}`} title="Click to edit" onClick={onClick}>
      <td className="pick" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select #${r.inv || '—'}`} />
      </td>
      {ITEM_COLUMNS.map((c) => {
        const cls = [c.num && 'num', typeof c.cls === 'function' ? c.cls(r) : c.cls].filter(Boolean).join(' ');
        const content = c.render(r);
        return <td key={c.key} className={cls}>{content == null && c.key === 'soldPrice' ? <span className="pill hold">on hand</span> : content}</td>;
      })}
      <td className="row-acts"><button className="row-act act-del" title="Delete this item" onClick={onDelete}>Delete</button></td>
    </tr>
  );
}

function EditorRow({ r, fields, setFields, boothOptions = [], onSave, onCancel }) {
  const set = (k) => (e) => setFields({ ...fields, [k]: e.target.value });
  const setBooth = (e) => {
    const id = e.target.value;
    const opt = boothOptions.find((o) => o.id === id);
    setFields({ ...fields, booth: id, store: opt ? opt.storeId : '' });
  };
  return (
    <tr className="editing">
      <td className="pick" />
      <td><input className="e-inv" value={fields.inv} onChange={set('inv')} aria-label="Inventory number" /></td>
      <td><input className="e-desc" autoFocus value={fields.desc} onChange={set('desc')} aria-label="Description" /></td>
      <td>{boothOptions.length
        ? <select className="e-booth" value={fields.booth || ''} onChange={setBooth} aria-label="Channel">
            <option value="">Unassigned</option>
            {boothOptions.map((o) => <option key={o.id} value={o.id}>{o.label}{o.store ? ` · ${o.store}` : ''}</option>)}
          </select>
        : <span className="muted">{r.category}</span>}</td>
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
