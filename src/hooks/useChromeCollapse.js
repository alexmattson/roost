import { useEffect } from 'react';

/**
 * App-like collapsing header: hide the mode/tab/filter chrome when the user
 * scrolls down, bring it back when they scroll up (or near the top). Toggles a
 * `chrome-collapsed` class on <body> that the CSS animates.
 *
 * The scrolling element differs per page (#main on Home/Analyze, .rec-cards or
 * .table-scroll on records pages), so we listen in the capture phase on the
 * document — scroll events don't bubble, but capture still sees them all.
 */
export function useChromeCollapse(enabled) {
  useEffect(() => {
    if (!enabled) { document.body.classList.remove('chrome-collapsed'); return undefined; }

    let lastY = 0;
    let collapsed = false;
    let ticking = false;
    let lockUntil = 0; // ignore state changes while a collapse/expand animates

    const set = (next) => {
      if (next === collapsed) return;
      collapsed = next;
      document.body.classList.toggle('chrome-collapsed', next);
      // Collapsing/expanding resizes the scroll container, which at the bottom
      // clamps scrollTop and fires scroll events with a reversed delta. Ignore
      // those for the length of the transition so it can't oscillate.
      lockUntil = Date.now() + 420;
    };

    const onScroll = (e) => {
      const el = e.target;
      if (!el || typeof el.scrollTop !== 'number') return;
      // Ignore scrolling inside overlays/menus — only the page's own scroll
      // should drive the header.
      if (el.closest && el.closest('.sheet, .sel-menu, .acct-pop, .toast-viewport')) return;
      const y = el.scrollTop;
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const delta = y - lastY;
        lastY = y;                         // always track, even while locked
        ticking = false;
        if (Date.now() < lockUntil) return; // settling after a toggle
        // At the very bottom the header resize clamps scrollTop; don't toggle
        // there or it flip-flops. Keep whatever state we arrived with.
        if (el.scrollHeight - (y + el.clientHeight) < 8) return;
        if (y < 40) set(false);            // always show near the top
        else if (delta > 6) set(true);     // scrolling down → collapse
        else if (delta < -6) set(false);   // scrolling up → reveal
      });
    };

    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      document.body.classList.remove('chrome-collapsed');
    };
  }, [enabled]);
}
