/**
 * Local sale alerts. Real push (fired when the app is closed) needs a backend
 * that watches Quail and sends a VAPID push; this app is browser-only, so these
 * are local notifications: when a fetch finds a sale newer than the baseline and
 * alerts are on, we post a system notification. On iOS this works only for the
 * installed PWA (16.4+) while it's running.
 */
const SINCE_KEY = 'roost_notify_since';
const ENABLED_KEY = 'roost_notify_enabled';

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const notifyPermission = () => (notifySupported() ? Notification.permission : 'unsupported');

export function alertsOn() {
  try { return localStorage.getItem(ENABLED_KEY) === '1' && notifyPermission() === 'granted'; }
  catch (e) { return false; }
}

const maxSoldAt = (sales) => sales.reduce((m, s) => Math.max(m, s.soldAt || 0), 0);

/** Turn alerts on: ask permission, and baseline to the newest current sale so
 *  only sales that arrive afterwards notify. Returns {ok} or {ok:false, reason}. */
export async function enableSaleAlerts(sales = []) {
  if (!notifySupported()) return { ok: false, reason: 'unsupported' };
  let perm = Notification.permission;
  if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; } }
  if (perm !== 'granted') return { ok: false, reason: perm };
  try {
    localStorage.setItem(ENABLED_KEY, '1');
    localStorage.setItem(SINCE_KEY, String(Math.max(maxSoldAt(sales), Date.now() - 1)));
  } catch (e) { /* storage is a convenience */ }
  return { ok: true };
}

export function disableSaleAlerts() {
  try { localStorage.setItem(ENABLED_KEY, '0'); } catch (e) { /* ignore */ }
}

/** After a fetch: notify about sales newer than the baseline, then advance it. */
export async function notifyNewSales(sales = [], money = (n) => `$${Math.round((n || 0) / 100)}`) {
  if (!alertsOn() || !sales.length) return;
  let since = 0;
  try { since = Number(localStorage.getItem(SINCE_KEY)) || 0; } catch (e) { since = 0; }
  const fresh = sales.filter((s) => (s.soldAt || 0) > since);
  if (!fresh.length) return;
  try { localStorage.setItem(SINCE_KEY, String(maxSoldAt(fresh))); } catch (e) { /* ignore */ }

  const total = fresh.reduce((a, s) => a + (s.price || 0), 0);
  const title = fresh.length === 1 ? 'New sale' : `${fresh.length} new sales`;
  const body = fresh.length === 1
    ? `${fresh[0].desc || 'Item'} · ${money(fresh[0].price)}`
    : `${fresh.length} sales · ${money(total)} total`;
  const opts = {
    body,
    icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
    badge: `${import.meta.env.BASE_URL}icons/icon-192.png`,
    tag: 'roost-sales'
  };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg && reg.showNotification) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch (e) { /* notifications are best-effort */ }
}
