/**
 * Roost core — the API orchestration, with nothing of where it runs.
 *
 * The extension's service worker and the hosted web app ask the same two
 * systems the same questions in the same order; all that differs is how the
 * request is made (a background fetch with an in-page fallback, or a plain
 * credentialed fetch) and how the session is obtained (read from a cookie, or
 * exchanged for a token by a login form). So the orchestration lives here,
 * parameterised by an injected `request`, and each host supplies the rest.
 *
 * Pure: no chrome, no window, no storage. Money stays in cents, dates in unix
 * seconds, exactly as the APIs speak them.
 */

export const SANDPIPER = 'https://app.sandpiperhq.com';
export const QUAIL = 'https://vendor.quailhq.com';
const PERMISSIONS_CLAIM = '@app-claim/@sandpiper/permissions';
const MAX_RENT_MONTHS = 36;

/* ------------------------------------------------------------------- tokens */

function b64urlDecode(part) {
  const pad = part.replace(/-/g, '+').replace(/_/g, '/');
  const str = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return decodeURIComponent(
    str.split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  );
}

/** The claims inside a Sandpiper JWT — its account list and expiry live here. */
export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) throw new Error('Session token is malformed.');
  return JSON.parse(b64urlDecode(parts[1]));
}

/** Account ids and username from a token, the same shape readSession returns. */
export function sessionFromToken(token) {
  const claims = decodeJwt(token);
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    const err = new Error('That session has expired — sign in again.');
    err.code = 'EXPIRED';
    throw err;
  }
  let accounts = [];
  try {
    const raw = claims[PERMISSIONS_CLAIM];
    const perms = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
    accounts = Array.isArray(perms.accounts) ? perms.accounts : [];
  } catch (e) { /* an account can still be chosen by hand */ }
  return { token, accounts, username: decodeURIComponent(claims.username || '') };
}

export const quailAuthHeader = (email, sessionId) => `Basic ${btoa(`${email}:${sessionId}`)}`;

/* ------------------------------------------------------------------ reading */

const ITEMS_BODY = { filters: [], orderBy: 'ACQUIRED', reverse: true };
const asArray = (p) => (Array.isArray(p) ? p : p ? [p] : []);

/** The whole item list. The range is deliberately huge so one call returns it. */
export async function fetchInventory({ request, accountId, token }) {
  const url = `${SANDPIPER}/api/items/v2/${accountId}/items?from=0&to=10000000`;
  const json = await request(url, `Bearer ${token}`, { method: 'POST', body: ITEMS_BODY });
  const items = Array.isArray(json) ? json : json.items || json.data || json.results || [];
  if (!Array.isArray(items)) throw new Error('Unexpected response shape from the Sandpiper API.');
  return items;
}

/** Store and booth names. Account-scoped list endpoints; a failure is reported,
 *  never fatal — an item sync must survive missing venue names. */
export async function fetchVenues({ request, accountId, token }) {
  const auth = `Bearer ${token}`;
  const stores = {};
  const booths = {};
  const errors = [];

  const [storeRes, boothRes] = await Promise.allSettled([
    request(`${SANDPIPER}/api/stores/${accountId}`, auth),
    request(`${SANDPIPER}/api/booths/${accountId}`, auth)
  ]);

  if (storeRes.status === 'fulfilled') {
    for (const v of asArray(storeRes.value)) {
      if (v && v.id) stores[v.id] = { name: v.name || null, city: v.city || null, state: v.state || null };
    }
  } else errors.push(`stores: ${storeRes.reason && storeRes.reason.message || storeRes.reason}`);

  if (boothRes.status === 'fulfilled') {
    for (const v of asArray(boothRes.value)) {
      if (!v || !v.id) continue;
      booths[v.id] = {
        name: v.name || null,
        storeId: v.storeId || null,
        consignmentRate: typeof v.consignmentRate === 'number' ? v.consignmentRate / 10000 : null,
        externalId: v.externalId != null ? v.externalId : null,
        externalService: v.externalService || null
      };
    }
  } else errors.push(`booths: ${boothRes.reason && boothRes.reason.message || boothRes.reason}`);

  return { stores, booths, errors, fetchedAt: Date.now() };
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function monthsBetween(from, to) {
  const out = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to && out.length < MAX_RENT_MONTHS) {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    out.push({ key: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`, start: ymd(first), end: ymd(last) });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/**
 * Quail's sales, booths and per-month rent. Scoped to the span Sandpiper knows
 * about, capped so the month loop stays bounded. Rent is a call per booth per
 * month, so it is gathered with allSettled — one 404 must not lose the rest.
 */
export async function fetchQuail({ request, quailAuth, quailEmail, items, tz }) {
  const tzParam = encodeURIComponent(tz || 'America/Los_Angeles');
  const stamps = items.map((i) => (Number(i.acquired) || 0) * 1000).filter(Boolean);
  const earliest = stamps.length ? new Date(Math.min(...stamps)) : new Date(Date.now() - 365 * 86400000);
  const floor = new Date(Date.now() - MAX_RENT_MONTHS * 31 * 86400000);
  const from = earliest > floor ? earliest : floor;
  const to = new Date(Date.now() + 86400000);
  const start = ymd(from);
  const end = ymd(to);

  const errors = [];
  const booths = await request(`${QUAIL}/api/portal/booths2?start=${start}&end=${end}&tz=${tzParam}`, quailAuth);
  const boothList = Array.isArray(booths) ? booths : [];

  const sales = [];
  const rent = [];
  const months = monthsBetween(from, to);

  for (const booth of boothList) {
    const id = booth.boothId;
    try {
      const rows = await request(`${QUAIL}/api/portal/booth-items?start=${start}&end=${end}&tz=${tzParam}&b=${id}`, quailAuth);
      if (Array.isArray(rows)) sales.push(...rows);
    } catch (e) {
      errors.push(`booth ${id} items: ${e.message}`);
    }
    const perMonth = await Promise.allSettled(months.map((m) =>
      request(`${QUAIL}/api/portal/rent?booth=${id}&start=${m.start}&end=${m.end}&tz=${tzParam}`, quailAuth)
        .then((v) => ({ boothId: id, month: m.key, cents: Math.round(Number(v) || 0) }))));
    for (const r of perMonth) {
      if (r.status === 'fulfilled') rent.push(r.value);
      else errors.push(String(r.reason && r.reason.message || r.reason));
    }
  }

  return { sales, booths: boothList, rent, errors, email: quailEmail, tz, range: { start, end }, fetchedAt: Date.now() };
}

/* ------------------------------------------------------------------ writing */

/** Create one item per row (quantity copies each), returning the new ids. */
export async function createItems({ request, accountId, token, rows }) {
  const auth = `Bearer ${token}`;
  const results = [];
  let created = 0;
  const born = [];
  for (const row of rows) {
    const quantity = Math.max(1, Math.round(Number(row.quantity) || 1));
    try {
      const ids = await request(
        `${SANDPIPER}/api/items/v2/${accountId}/create?quantity=${encodeURIComponent(quantity)}`,
        auth, { method: 'POST', body: row.item });
      const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
      if (!list.length) throw new Error('Sandpiper created the item but returned no id.');
      for (const id of list) born.push({ ...row.item, id });
      created += list.length;
      results.push({ inv: row.item.inventoryNumber, ok: true, ids: list });
    } catch (e) {
      results.push({ inv: row.item.inventoryNumber, ok: false, error: e.message || String(e) });
    }
  }
  return { results, created, born };
}

/**
 * Apply edits one at a time. The edit endpoint replaces the whole record, so
 * each payload is the untouched API row with the planned fields overlaid.
 */
export async function applyEdits({ request, accountId, token, plans, byId }) {
  const auth = `Bearer ${token}`;
  const results = [];
  const written = [];
  for (const plan of plans) {
    const raw = byId.get(plan.itemId);
    if (!raw) {
      results.push({ itemId: plan.itemId, ok: false, error: 'Item is no longer in the local cache.' });
      continue;
    }
    const payload = { ...raw };
    for (const c of plan.changes || []) payload[c.field] = c.to;
    for (const field of ['acquired', 'sold']) {
      if (typeof payload[field] === 'number') payload[field] = Math.round(payload[field]);
    }
    try {
      await request(`${SANDPIPER}/api/items/v2/${accountId}/edit`, auth, { method: 'POST', body: payload });
      results.push({ itemId: plan.itemId, ok: true, payload });
      written.push(payload);
    } catch (e) {
      results.push({ itemId: plan.itemId, ok: false, error: e.message || String(e) });
    }
  }
  return { results, written };
}

/** Delete items one at a time, stopping at the first refusal. */
export async function deleteItems({ request, accountId, token, ids }) {
  const auth = `Bearer ${token}`;
  const results = [];
  const gone = new Set();
  for (const id of ids) {
    try {
      await request(`${SANDPIPER}/api/items/v2/${accountId}/delete?id=${encodeURIComponent(id)}`, auth, { method: 'POST' });
      gone.add(id);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e.message || String(e) });
      break;
    }
  }
  return { results, gone };
}

/* -------------------------------------------------------------------- login */

/* No loginSandpiper here on purpose: Sandpiper's /login route sends no CORS
 * headers, so a browser on another origin cannot exchange a password for a
 * token — only use a token it already holds (see sessionFromToken). Its /api
 * data routes do send CORS, so once a token is in hand everything else works.
 * Quail's login lives under /api and does send CORS, so it can sign in here. */

/** Quail login: email + password in, a session id out (in the body, not a cookie). */
export async function loginQuail({ request, email, password }) {
  const res = await request(`${QUAIL}/api/auth/login`, null, {
    method: 'POST', body: { email, password, source: 'WEB' }, auth: false
  });
  const sessionId = res && (res.sessionId || res.session);
  if (!sessionId) throw new Error('Quail accepted the sign-in but returned no session.');
  return { email: (res && res.email) || email, sessionId };
}
