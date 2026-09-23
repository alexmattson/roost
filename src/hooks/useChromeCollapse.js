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
export function useChromeCollapse(enabled, sticky = false) {
  useEffect(() => {
    // Not enabled (Home) still tracks `scrolled` for the frosted background; it
    // just never collapses, so make sure any lingering collapse is cleared.
    if (!enabled) document.body.classList.remove('chrome-collapsed');

    let lastY = 0;
    let collapsed = false;
    let scrolled = false;
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
    const setScrolled = (next) => {
      if (next === scrolled) return;
      scrolled = next;
      document.body.classList.toggle('scrolled', next);
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
        // The frosted background shows only once we're off the very top — this
        // runs on every page (Home included), independent of the collapse.
        setScrolled(y > 4);
        if (!enabled) return;              // collapse only where enabled (not Home)
        if (Date.now() < lockUntil) return; // settling after a toggle
        // At the very bottom the header resize clamps scrollTop; don't toggle
        // there or it flip-flops. Keep whatever state we arrived with.
        if (el.scrollHeight - (y + el.clientHeight) < 8) return;
        if (sticky) {
          // Records/tables: collapse on scroll-down and STAY collapsed while
          // navigating; only a click on the breadcrumb brings the nav back.
          if (y > 8 && delta > 1) set(true);
        } else {
          if (y < 8) set(false);           // only right at the very top
          else if (delta > 1) set(true);   // any scroll down → collapse at once
          else if (delta < -2) set(false); // a small scroll up → reveal
        }
      });
    };

    // The breadcrumb (and anything else) can request an expand by event — this
    // is the only way out of the collapsed state in sticky mode.
    const onExpand = () => set(false);

    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('roost:chrome-expand', onExpand);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('roost:chrome-expand', onExpand);
      document.body.classList.remove('chrome-collapsed');
      document.body.classList.remove('scrolled');
    };
  }, [enabled, sticky]);
}
