import { useEffect, useMemo, useState } from 'react';
import { useData } from '../store/data.jsx';
import { Button } from '../components/ui.jsx';
import { useToast } from '../store/toast.jsx';

/**
 * Manage the Sandpiper stores and booths that back every channel.
 *
 * Quail-linked venues (externalId set) are managed by the register and shown
 * read-only. Anything you create here with no link is a Direct channel — make a
 * "Facebook Marketplace" store + booth and sales attributed to it report as a
 * separate channel everywhere. All writes go straight to Sandpiper's API.
 */
export function ManageChannels({ onClose }) {
  const { venueInfo, manageVenue } = useData();
  const [busy, setBusy] = useState(false);
  const flash = useToast();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const run = async (op, payload, okMsg) => {
    setBusy(true);
    try { await manageVenue(op, payload); if (okMsg) flash('ok', okMsg); }
    catch (e) { flash('error', e.message || String(e), 0); }
    finally { setBusy(false); }
  };

  const stores = venueInfo.stores || {};
  const booths = venueInfo.booths || {};
  const rawStores = venueInfo.rawStores || {};
  const rawBooths = venueInfo.rawBooths || {};

  const storeList = useMemo(() => Object.keys(stores).map((id) => ({ id, ...stores[id] }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [stores]);
  const boothsByStore = useMemo(() => {
    const m = {};
    for (const id of Object.keys(booths)) {
      const b = booths[id];
      (m[b.storeId] = m[b.storeId] || []).push({ id, ...b });
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return m;
  }, [booths]);

  return (
    <section id="manage-channels" className="sheet">
      <div className="sheet-head">
        <div>
          <h2>Manage channels</h2>
          <p className="sheet-sub">Stores and booths in Sandpiper. Create an unlinked store to add a direct channel like Facebook Marketplace.</p>
        </div>
        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </div>

      <div className="mc-body">

        <NewStore onCreate={(v) => run('createStore', v, `Added ${v.name}.`)} busy={busy} />

        {storeList.length === 0 && <div className="empty-row">No stores yet. Add one above.</div>}

        {storeList.map((store) => {
          const linked = store.externalId != null;
          return (
            <div key={store.id} className={`mc-store ${linked ? 'linked' : ''}`}>
              <StoreRow store={store} raw={rawStores[store.id]} linked={linked} busy={busy}
                onSave={(name) => run('editStore', { store: { ...rawStores[store.id], name } }, 'Store renamed.')}
                onDelete={() => run('deleteStore', { storeId: store.id }, 'Store removed.')} />
              <div className="mc-booths">
                {(boothsByStore[store.id] || []).map((booth) => (
                  <BoothRow key={booth.id} booth={booth} raw={rawBooths[booth.id]} busy={busy}
                    onSave={(number, ratePct) => run('editBooth', {
                      booth: { ...rawBooths[booth.id], number, name: number, consignmentRate: Math.round((Number(ratePct) || 0) / 100 * 10000) }
                    }, `Booth ${number} saved.`)}
                    onDelete={() => run('deleteBooth', { boothId: booth.id }, 'Booth removed.')} />
                ))}
                {!linked && (
                  <NewBooth busy={busy}
                    onCreate={(number, ratePct) => run('createBooth', { storeId: store.id, number, consignmentRate: (Number(ratePct) || 0) / 100 }, `Added booth ${number}.`)} />
                )}
                {linked && !(boothsByStore[store.id] || []).length && <div className="mc-note">Quail-linked — managed in the register.</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NewStore({ onCreate, busy }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  if (!open) return <div className="mc-add"><Button small onClick={() => setOpen(true)}>+ Add store / channel</Button></div>;
  const submit = () => { if (name.trim()) { onCreate({ name: name.trim(), city: city.trim(), state: state.trim() }); setName(''); setCity(''); setState(''); setOpen(false); } };
  return (
    <div className="mc-form">
      <input autoFocus placeholder="Store or channel name (e.g. Facebook Marketplace)" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="City (optional)" value={city} onChange={(e) => setCity(e.target.value)} />
      <input className="mc-state" placeholder="State" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} />
      <Button small variant="primary" disabled={busy || !name.trim()} onClick={submit}>Add</Button>
      <Button small variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function StoreRow({ store, linked, busy, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(store.name || '');
  useEffect(() => setName(store.name || ''), [store.name]);
  return (
    <div className="mc-store-head">
      {editing ? (
        <>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <Button small variant="primary" disabled={busy || !name.trim()} onClick={() => { onSave(name.trim()); setEditing(false); }}>Save</Button>
          <Button small variant="ghost" onClick={() => { setName(store.name || ''); setEditing(false); }}>Cancel</Button>
        </>
      ) : (
        <>
          <h3>{store.name || 'Unnamed store'}{store.city ? <span className="mc-loc"> · {[store.city, store.state].filter(Boolean).join(', ')}</span> : null}</h3>
          {linked
            ? <span className="pill probable">Quail-linked</span>
            : <span className="pill">Direct</span>}
          {!linked && <div className="mc-store-acts">
            <button className="linklike" onClick={() => setEditing(true)}>Rename</button>
            <button className="linklike danger" disabled={busy} onClick={onDelete}>Delete</button>
          </div>}
        </>
      )}
    </div>
  );
}

function BoothRow({ booth, busy, onSave, onDelete }) {
  const linked = booth.externalId != null;
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(booth.name || '');
  const [ratePct, setRatePct] = useState(booth.consignmentRate != null ? String(Math.round(booth.consignmentRate * 1000) / 10) : '0');
  useEffect(() => { setNumber(booth.name || ''); setRatePct(booth.consignmentRate != null ? String(Math.round(booth.consignmentRate * 1000) / 10) : '0'); }, [booth.name, booth.consignmentRate]);
  const rateText = booth.consignmentRate != null ? `${Math.round(booth.consignmentRate * 1000) / 10}%` : '—';

  if (editing) {
    return (
      <div className="mc-booth editing">
        <input className="mc-num" autoFocus value={number} onChange={(e) => setNumber(e.target.value)} aria-label="Booth number" />
        <span className="mc-rate-edit"><input value={ratePct} inputMode="decimal" onChange={(e) => setRatePct(e.target.value)} aria-label="Consignment %" />%</span>
        <Button small variant="primary" disabled={busy || !number.trim()} onClick={() => { onSave(number.trim(), ratePct); setEditing(false); }}>Save</Button>
        <Button small variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    );
  }
  return (
    <div className="mc-booth">
      <span className="mc-booth-name">#{booth.name || '—'}</span>
      <span className="mc-booth-rate">{rateText} consignment</span>
      {linked
        ? <span className="pill probable">Quail-linked</span>
        : <div className="mc-store-acts">
          <button className="linklike" onClick={() => setEditing(true)}>Edit</button>
          <button className="linklike danger" disabled={busy} onClick={onDelete}>Delete</button>
        </div>}
    </div>
  );
}

function NewBooth({ onCreate, busy }) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [ratePct, setRatePct] = useState('0');
  if (!open) return <button className="linklike mc-add-booth" onClick={() => setOpen(true)}>+ Add booth</button>;
  const submit = () => { if (number.trim()) { onCreate(number.trim(), ratePct); setNumber(''); setRatePct('0'); setOpen(false); } };
  return (
    <div className="mc-booth editing">
      <input className="mc-num" autoFocus placeholder="Booth #" value={number} onChange={(e) => setNumber(e.target.value)} />
      <span className="mc-rate-edit"><input value={ratePct} inputMode="decimal" onChange={(e) => setRatePct(e.target.value)} aria-label="Consignment %" />%</span>
      <Button small variant="primary" disabled={busy || !number.trim()} onClick={submit}>Add</Button>
      <Button small variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}
