import { useMemo, useState, useEffect, useRef } from 'react';
import { useData } from '../store/data.jsx';
import { useNav } from '../store/nav.jsx';
import { takenNumbers, numberKey } from '../lib/stock.js';
import { ITEM_COLUMNS, ITEM_ACTS_W, filterItems, collectChanges, editFields } from '../lib/items.js';
import { makeVenueLabels } from '../lib/venues.js';
import { money } from '../lib/format.js';
import { useToast } from '../store/toast.jsx';
import { useIsMobile } from '../hooks/useMediaQuery.js';
import { Button } from '../components/ui.jsx';
import { RecordsCard, FilterPill, SearchPill } from '../components/RecordsCard.jsx';
import { SortableTable } from '../components/SortableTable.jsx';
import { PrintTags } from './PrintTags.jsx';
import { EditItemSheet } from './EditItemSheet.jsx';

const FILTERS = [
  ['all', 'All items'], ['onhand', 'Unsold only'], ['sold', 'Sold only'], ['loss', 'Sold at a loss'],
  ['noprice', 'Missing asking price'], ['zerocost', 'No cost recorded'], ['aged', 'Held over 180 days'], ['nobarcode', 'No barcode yet']
];

export function Inventory() {
  const { items, applyEdits, deleteItems, venueInfo, venueNames } = useData();
  const { range, inventoryFilter, setInventoryFilter, openAddStock } = useNav();
  const isMobile = useIsMobile();

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

  const flash = useToast();
  const startEdit = (r) => { setEditingId(r.id); setFields(editFields(r)); };
  const cancelEdit = () => { setEditingId(null); setFields(null); };

  // Esc cancels the in-progress row edit (deselects the editing row).
  useEffect(() => {
    if (!editingId) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingId]);

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

  // On mobile a row is edited in a full-screen sheet rather than inline.
  const editingItem = items.find((i) => i.id === editingId) || null;
  const deleteFromSheet = () => { const id = editingId; cancelEdit(); doDelete([id]); };

  return (
    <RecordsCard
      filters={<>
        <FilterPill value={filter} ariaLabel="Filter items"
          onChange={(v) => { setFilter(v); setInventoryFilter(v); }}
          options={FILTERS.map(([v, l]) => ({ value: v, label: l }))} />
        {selected.size > 0 && boothOptions.length > 0 && (
          <FilterPill value="" ariaLabel="Assign selected to a channel" placeholder="Assign channel…"
            onChange={(v) => { if (v) bulkAssign(v); }}
            options={[
              ...boothOptions.map((o) => ({ value: o.id, label: `${o.label}${o.store ? ` · ${o.store}` : ''}` })),
              { value: '__unassign__', label: 'Unassigned' }
            ]} />
        )}
      </>}
      search={<SearchPill placeholder="Search description or #…" value={search} onChange={(e) => setSearch(e.target.value)} />}
      actions={<>
        <Button small onClick={() => setShowPrint(true)}>Print tags{selected.size ? ` (${selected.size})` : ''}</Button>
        <Button small variant="primary" onClick={openAddStock}>+ Add stock</Button>
      </>}
    >
      <DeleteBar pending={deletePending} busy={busy} items={items}
        onCancel={() => setDeletePending(null)} onGo={() => doDelete(deletePending)} />

      {isMobile ? (
        <ItemCards rows={rows} selected={selected} onToggle={toggleOne} onOpen={startEdit} limit={400} />
      ) : (
        <div className="table-scroll">
          <SortableTable
            columns={ITEM_COLUMNS} rows={rows} fixed actsWidth={ITEM_ACTS_W} leadWidth={4}
            initialSort={{ key: 'acquired', dir: -1 }} limit={400}
            leadingHeader={<th className="pick"><SelectAll checked={allChecked} indeterminate={someChecked} onChange={toggleAll} /></th>}
            trailingHeader={<th className="row-acts" />} renderRow={renderRow}
            empty="No items match those filters" />
        </div>
      )}

      {isMobile && editingItem && (
        <EditItemSheet r={editingItem} fields={fields} setFields={setFields} boothOptions={boothOptions}
          busy={busy} onSave={() => save(editingItem)} onCancel={cancelEdit} onDelete={deleteFromSheet} />
      )}

      {showPrint && <PrintTags rows={printRows} onClose={() => setShowPrint(false)} />}
    </RecordsCard>
  );
}

function SelectAll({ checked, indeterminate, onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label="Select all shown items" />;
}

/** Mobile: each item is a tappable card (tap opens the edit sheet) instead of a
 *  row in the wide, unusable desktop table. The checkbox still picks for print. */
function ItemCards({ rows, selected, onToggle, onOpen, limit }) {
  if (!rows.length) return <div className="empty-row">No items match those filters</div>;
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <div className="rec-cards">
      {shown.map((r) => (
        <ItemCard key={r.id} r={r} checked={selected.has(r.id)} onToggle={() => onToggle(r.id)} onOpen={() => onOpen(r)} />
      ))}
      {limit && rows.length > shown.length && (
        <div className="empty-row">Showing first {shown.length} of {rows.length}</div>
      )}
    </div>
  );
}

function ItemCard({ r, checked, onToggle, onOpen }) {
  const channel = r.channelLabel && r.channelLabel !== 'Unassigned' ? r.channelLabel : null;
  return (
    <div className={`rec-card item-card${checked ? ' picked' : ''}`}>
      <label className="rc-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select #${r.inv || '—'}`} />
      </label>
      <button className="rc-main" onClick={onOpen}>
        <div className="rc-line1">
          <span className="rc-inv">#{r.inv || '—'}</span>
          <span className="rc-title">{r.desc}</span>
        </div>
        <div className="rc-line2">{[r.category, channel].filter(Boolean).join(' · ') || '—'}</div>
        <div className="rc-figs">
          <span className="rc-fig"><i>Cost</i><b>{money(r.cost, { compact: true })}</b></span>
          <span className="rc-fig"><i>Ask</i><b>{money(r.ask, { compact: true })}</b></span>
          {r.isSold
            ? <span className="rc-fig sold"><i>Sold</i><b>{money(r.soldPrice, { compact: true })}</b></span>
            : <span className="pill hold">on hand</span>}
        </div>
      </button>
    </div>
  );
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
      <td className="muted">{r.category}</td>
      <td>{boothOptions.length
        ? <select className="e-booth" value={fields.booth || ''} onChange={setBooth} aria-label="Booth / channel">
            <option value="">Unassigned</option>
            {boothOptions.map((o) => <option key={o.id} value={o.id}>{o.label}{o.store ? ` · ${o.store}` : ''}</option>)}
          </select>
        : <span className="muted">—</span>}</td>
      <td><input type="date" className="e-acquired" value={fields.acquired} onChange={set('acquired')} aria-label="Acquired date" /></td>
      <td><input className="e-cost num" value={fields.cost} onChange={set('cost')} inputMode="decimal" aria-label="Cost" /></td>
      <td><input className="e-ask num" value={fields.ask} onChange={set('ask')} inputMode="decimal" aria-label="Asking price" /></td>
      <td><input type="date" className="e-sold" value={fields.sold} onChange={set('sold')} aria-label="Sold date" /></td>
      <td><input className="e-soldPrice num" value={fields.soldPrice} onChange={set('soldPrice')} inputMode="decimal" aria-label="Sold price" placeholder={r.isSold ? undefined : 'mark sold'} /></td>
      <td colSpan={3} className="row-acts">
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
