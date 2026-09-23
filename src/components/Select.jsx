import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A styled select: a pill trigger and a floating options menu, replacing the
 * native <select> so the dropdown matches the app's design (and behaves the
 * same in every browser). Fully keyboard-driven and click-outside aware.
 *
 * The menu renders in a portal (fixed-positioned to the trigger) so it can't be
 * clipped by an `overflow:hidden` ancestor (e.g. the collapsing header), and so
 * opening it never scrolls a parent container.
 *
 * Props:
 *   value     — the selected value (compared as a string)
 *   onChange  — called with the chosen value (not an event)
 *   options   — [{ value, label, disabled? }] or groups
 *               [{ label, options: [{ value, label }] }]; the two may mix
 *   placeholder — shown when `value` matches no option
 *   ariaLabel, className, disabled
 */
export function Select({ value, onChange, options = [], placeholder, ariaLabel, className = '', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // highlighted flat index
  const [pos, setPos] = useState(null);     // { left, width, top?, bottom?, drop }
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const flat = flatten(options);
  const selected = flat.find((o) => String(o.value) === String(value));
  const label = selected ? selected.label : (placeholder != null ? placeholder : (value != null ? String(value) : ''));

  const firstEnabled = () => flat.findIndex((o) => !o.disabled);

  // Position the portaled menu against the trigger, flipping up when short on room.
  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 240 && r.top > below;
    // Anchor to the trigger's right edge when it sits in the right half, so a
    // menu wider than the trigger grows inward instead of off-screen.
    const rightAlign = (r.left + r.width / 2) > window.innerWidth / 2;
    setPos({
      left: rightAlign ? null : Math.round(r.left),
      right: rightAlign ? Math.round(window.innerWidth - r.right) : null,
      width: Math.round(r.width),
      top: up ? null : Math.round(r.bottom + 6),
      bottom: up ? Math.round(window.innerHeight - r.top + 6) : null,
      drop: up ? 'up' : 'down'
    });
  }, []);

  const openMenu = () => {
    if (disabled) return;
    const cur = flat.findIndex((o) => String(o.value) === String(value) && !o.disabled);
    setActive(cur >= 0 ? cur : firstEnabled());
    place();
    setOpen(true);
  };
  const close = (focusBtn = true) => { setOpen(false); if (focusBtn && btnRef.current) btnRef.current.focus(); };

  // Close on outside click — the menu is portaled, so check it explicitly too.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && rootRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Keep the menu pinned to the trigger while open (scroll/resize), and the
  // active option in view — the latter scrolls only the menu, never the page.
  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => { window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true); };
  }, [open, place]);
  useLayoutEffect(() => {
    if (!open) return;
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
      {open && pos && createPortal(
        <div ref={menuRef} className={`sel-menu drop-${pos.drop}`} role="listbox" aria-label={ariaLabel}
          onKeyDown={onKey} tabIndex={-1}
          style={{
            position: 'fixed', minWidth: pos.width, zIndex: 200,
            left: pos.left == null ? 'auto' : pos.left,
            right: pos.right == null ? 'auto' : pos.right,
            top: pos.top == null ? 'auto' : pos.top,
            bottom: pos.bottom == null ? 'auto' : pos.bottom
          }}>
          {options.map((o, gi) => (Array.isArray(o.options)
            ? (
              <div key={`g${gi}`} role="group" aria-label={typeof o.label === 'string' ? o.label : undefined} className="sel-group">
                <div className="sel-group-label">{o.label}</div>
                {o.options.map(renderOption)}
              </div>
            )
            : renderOption(o)))}
        </div>,
        document.body
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
