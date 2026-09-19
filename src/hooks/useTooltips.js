import { useEffect } from 'react';
import { showTip, hideTip } from '../lib/charts.js';
import { matchTip } from '../lib/reconcile-ui.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * One delegated hover tooltip for the whole app, using the styled bubble the
 * charts use. Elements opt in with `data-tip` (plain text) or `data-match`
 * (the full exact/probable/manual key). Mounted once at the app root.
 */
export function useTooltips() {
  useEffect(() => {
    const pick = (e) => (e.target.closest ? e.target.closest('[data-match],[data-tip]') : null);
    const html = (el) => (el.dataset.match ? matchTip(el.dataset.match) : esc(el.getAttribute('data-tip')));
    const show = (e) => { const el = pick(e); if (el) showTip(html(el), e); };
    const out = (e) => { if (pick(e)) hideTip(); };
    document.body.addEventListener('mouseover', show);
    document.body.addEventListener('mousemove', show);
    document.body.addEventListener('mouseout', out);
    return () => {
      document.body.removeEventListener('mouseover', show);
      document.body.removeEventListener('mousemove', show);
      document.body.removeEventListener('mouseout', out);
    };
  }, []);
}
