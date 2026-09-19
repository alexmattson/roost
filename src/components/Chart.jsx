import { useRef, useLayoutEffect, useEffect } from 'react';
import { refreshPalette } from '../lib/charts.js';

/**
 * Mounts one of the hand-rolled SVG charts from lib/charts.js into a container.
 * `draw(el)` calls the imperative builder (barChart, lineChart, …) against the
 * element. Redraws when `deps` change and on resize, re-reading the theme's
 * chart palette each time so light/dark switches follow.
 */
export function Chart({ draw, deps = [], className = '' }) {
  const ref = useRef(null);

  const render = () => {
    const el = ref.current;
    if (!el) return;
    refreshPalette();
    draw(el);
  };

  useLayoutEffect(render, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(render);
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={ref} className={`chart-box ${className}`.trim()} />;
}
