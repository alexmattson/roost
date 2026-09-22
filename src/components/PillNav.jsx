import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * A segmented pill nav where a single "pill" indicator glides between options
 * instead of the background jumping. Shared by the mode and tab bars.
 *
 * items: [{ id, label }] (label may be a node, e.g. text + a badge)
 * value: the active id · onChange(id) · size: 'mode' | 'tab'
 */
export function PillNav({ items, value, onChange, size = 'mode', className = '', ariaLabel }) {
  const listRef = useRef(null);
  const btnRefs = useRef({});
  const [ind, setInd] = useState(null);

  const measure = useCallback(() => {
    const el = btnRefs.current[value];
    if (!el) return;
    const left = el.offsetLeft;
    const width = el.offsetWidth;
    // Guarded so a no-op measurement doesn't trigger a needless re-render.
    setInd((p) => (p && p.left === left && p.width === width ? p : { left, width }));
  }, [value]);

  // Measure on mount, whenever the active value changes (measure is rebuilt),
  // and whenever the bar itself resizes — a ResizeObserver catches label/badge
  // width changes too. There is deliberately no measure-on-every-render effect:
  // that creates a render -> setState -> render cycle. Because setInd only moves
  // the absolutely-positioned indicator, it never resizes the bar, so the
  // observer can't feed back into itself.
  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    let ro;
    if (typeof ResizeObserver !== 'undefined' && listRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(listRef.current);
    }
    return () => { window.removeEventListener('resize', measure); if (ro) ro.disconnect(); };
  }, [measure]);

  return (
    <div ref={listRef} className={`pillnav pillnav-${size} ${ind ? 'ready' : ''} ${className}`.trim().replace(/\s+/g, ' ')} role="group" aria-label={ariaLabel}>
      {ind && (
        <span className="pillnav-ind" aria-hidden="true"
          style={{ transform: `translateX(${ind.left}px)`, width: `${ind.width}px` }} />
      )}
      {items.map((it) => (
        <button key={it.id} type="button"
          ref={(n) => { btnRefs.current[it.id] = n; }}
          className={`pillnav-btn ${value === it.id ? 'on' : ''}`}
          aria-current={value === it.id ? 'true' : undefined}
          onClick={() => onChange(it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
