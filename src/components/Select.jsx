import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A styled select: a pill trigger and a floating options menu, replacing the
 * native <select> so the dropdown matches the app's design (and behaves the
 * same in every browser). Fully keyboard-driven and click-outside aware.
 *
 * Props:
 *   value     — the selected value (compared as a string)
 *   onChange  — called with the chosen value (not an event)
 *   options   — [{ value, label, disabled? }] or groups
 *               [{ label, options: [{ value, label }] }]; the two may mix
 *   placeholder — shown when `value` matches no option
 *   ariaLabel, className, disabled, align ('left' | 'right' menu edge)
 */
export function Select({ value, onChange, options = [], placeholder, ariaLabel, className = '', disabled = false, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // highlighted flat index
  const [drop, setDrop] = useState('down');
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const flat = flatten(options);
  const selected = flat.find((o) => String(o.value) === String(value));
  const label = selected ? selected.label : (placeholder != null ? placeholder : (value != null ? String(value) : ''));

  const firstEnabled = () => flat.findIndex((o) => !o.disabled);

  const openMenu = () => {
    if (disabled) return;
    const cur = flat.findIndex((o) => String(o.value) === String(value) && !o.disabled);
    setActive(cur >= 0 ? cur : firstEnabled());
    setOpen(true);
  };
  const close = (focusBtn = true) => { setOpen(false); if (focusBtn && btnRef.current) btnRef.current.focus(); };

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Choose a drop direction with room for the menu, and keep the active row in view.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      setDrop(below < 240 && r.top > below ? 'up' : 'down');
    }
    const el = menuRef.current && menuRef.current.querySelector(`[data-idx="${active}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const commit = (i) => {
    const o = flat[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  };
  const move = (dir) => setActive((cur) => {
    let i = cur;
    for (let n = 0; n < flat.length; n++) {
      i = (i + dir + flat.length) % flat.length;
      if (!flat[i].disabled) return i;
    }
    return cur;
  });

  const onKey = (e) => {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    switch (e.key) {
      case 'Escape': e.preventDefault(); close(); break;
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': e.preventDefault(); setActive(firstEnabled()); break;
      case 'End': e.preventDefault(); { let i = flat.length - 1; while (i > 0 && flat[i].disabled) i -= 1; setActive(i); } break;
      case 'Enter': case ' ': e.preventDefault(); commit(active); break;
      case 'Tab': close(false); break;
      default: break;
    }
  };

  // Walk options in render order, assigning each a flat index for keyboard mapping.
  let idx = -1;
  const renderOption = (o) => {
    idx += 1;
    const i = idx;
    const on = String(o.value) === String(value);
    return (
      <div key={`${o.value}-${i}`} role="option" aria-selected={on} data-idx={i}
        className={`sel-opt${on ? ' on' : ''}${i === active ? ' active' : ''}${o.disabled ? ' disabled' : ''}`}
        onMouseEnter={() => !o.disabled && setActive(i)}
        onMouseDown={(e) => { e.preventDefault(); commit(i); }}>
        <span className="sel-opt-label">{o.label}</span>
        {on && <CheckGlyph />}
      </div>
    );
  };

  return (
    <div ref={rootRef} className={`sel${open ? ' open' : ''}${disabled ? ' disabled' : ''} ${className}`.trim()}>
      <button type="button" ref={btnRef} className="sel-btn" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => (open ? close() : openMenu())} onKeyDown={onKey}>
        <span className={`sel-value${selected ? '' : ' placeholder'}`}>{label}</span>
        <ChevronGlyph />
      </button>
      {open && (
        <div ref={menuRef} className={`sel-menu drop-${drop} align-${align}`} role="listbox" aria-label={ariaLabel}>
          {options.map((o, gi) => (Array.isArray(o.options)
            ? (
              <div key={`g${gi}`} role="group" aria-label={typeof o.label === 'string' ? o.label : undefined} className="sel-group">
                <div className="sel-group-label">{o.label}</div>
                {o.options.map(renderOption)}
              </div>
            )
            : renderOption(o)))}
        </div>
      )}
    </div>
  );
}

function flatten(options) {
  const out = [];
  for (const o of options) {
    if (o && Array.isArray(o.options)) out.push(...o.options);
    else out.push(o);
  }
  return out;
}

const ChevronGlyph = () => (
  <svg className="sel-chev" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckGlyph = () => (
  <svg className="sel-check" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
