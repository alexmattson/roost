/**
 * The web build's stand-in for the service worker.
 *
 * The extension answers popup.js's `send()` from a background worker that reads
 * cookies and fetches. On the web there is no worker and no cookie to read: the
 * user signs in on the page, the tokens live here, and the same core
 * orchestration runs inline. `webSend` speaks the exact protocol the worker
 * does, so popup.js cannot tell which one it is talking to.
 *
 * Tokens sit in sessionStorage — they survive a reload but not closing the tab,
 * and they never leave the browser. The item cache sits in localStorage, the
 * same durable store the extension uses.
 */

import * as core from './core.js';

export const WEB_BUILD = 'web';
const SESSION_KEY = 'roost_web_session';
const CACHE_KEY = 'roost_web_cache';

let session = null;

function load() {
  if (session) return session;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
  return session;
}
function persist() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* private window */ }
}
export function currentWebSession() { return load(); }
export function isWebAuthed() { return !!(load() && session.sandpiperToken); }
export function signOutWeb() {
  session = null;
  try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
}

/**
 * The web's request: a plain credentialed fetch. No in-page fallback — that
 * exists in the extension only to dodge an Origin check, and both APIs send
 * permissive CORS anyway. `init.auth === false` is login, which carries no token.
 */
async function request(url, authorization, init = {}) {
  const headers = { Accept: 'application/json' };
  if (authorization && init.auth !== false) headers.authorization = authorization;
  if (init.body) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, {
      method: init.method || 'GET',
      credentials: 'include',
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined
    });
  } catch (e) {
    throw new Error(`Could not reach ${new URL(url).hostname}. Check your connection and that you are online.`);
  }
  if (!res.ok) {
    const err = new Error(`${new URL(url).hostname} returned ${res.status} ${res.statusText}.`);
    err.status = res.status;
    if (res.status === 401 || res.status === 403) {
      err.code = 'UNAUTHORIZED';
      err.message = `Your session was rejected (${res.status}). Sign in again.`;
    }
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch (e) {
    const err = new Error(`Unexpected non-JSON reply from ${new URL(url).hostname}.`);
    err.status = res.status;
    throw err;
  }
}

/* The two systems connect independently — one can be live while the other is
 * not — so each has its own connect, and status reports them apart. The session
 * holds whichever halves are filled; only Sandpiper is required to enter. */

function blankSession() {
  return { sandpiperToken: null, accounts: [], username: '', accountId: null, quailAuth: null, quailEmail: null };
}

/** Where each system stands, for the two status rows on the sign-in screen. */
export function webStatus() {
  const s = load();
  return {
    sandpiper: { connected: !!(s && s.sandpiperToken), user: (s && s.username) || '' },
    quail: { connected: !!(s && s.quailAuth), email: (s && s.quailEmail) || '' }
  };
}

/**
 * Connect Sandpiper with a token it already holds.
 *
 * Its data API sends CORS and takes a Bearer token, but its login route sends
 * none, so a browser on another origin cannot turn a password into a token —
 * only use one the bookmarklet carried over. The token is decoded, then proven
 * with one real call before it is kept, so a stale one fails here.
 */
export async function connectSandpiper(sandpiperToken) {
  const token = String(sandpiperToken || '').trim();
  if (!token) throw new Error('No Sandpiper token yet — use Connect, or paste one.');
  let s;
  try {
    s = core.sessionFromToken(token);
  } catch (e) {
    if (e.code === 'EXPIRED') throw e;
    throw new Error('That does not look like a Sandpiper session token.');
  }
  if (!s.accounts.length) throw new Error('That token carries no Sandpiper account — copy the whole value.');
  const accountId = s.accounts[0];

  try {
    await core.fetchVenues({ request, accountId, token });
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw new Error('Sandpiper rejected that token — it may be stale. Connect again for a fresh one.');
    }
    throw e;
  }

  if (!load()) session = blankSession();
  Object.assign(session, { sandpiperToken: token, accounts: s.accounts, username: s.username, accountId });
  persist();
  return { user: s.username };
}

/** Connect Quail with an email and password — its login is under /api, so it
 *  works on the page, and the call itself is the validation. */
export async function connectQuail({ email, password }) {
  if (!email || !password) throw new Error('Enter your Quail email and password.');
  const q = await core.loginQuail({ request, email, password });
  if (!load()) session = blankSession();
  session.quailEmail = q.email;
  session.quailAuth = core.quailAuthHeader(q.email, q.sessionId);
  persist();
  return { email: q.email };
}

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; } }
function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ } }

async function doRefresh() {
  if (!load() || !session.sandpiperToken) throw new Error('Sign in first.');
  if (!session.accountId) throw new Error('No Sandpiper account is available on this sign-in.');
  const token = session.sandpiperToken;
  const accountId = session.accountId;

  const items = await core.fetchInventory({ request, accountId, token });

  let venues = { stores: {}, booths: {}, errors: [] };
  try { venues = await core.fetchVenues({ request, accountId, token }); }
  catch (e) { venues.errors = [e.message || String(e)]; }

  let quail = null;
  let quailError = null;
  if (session.quailAuth) {
    try {
      quail = await core.fetchQuail({
        request, quailAuth: session.quailAuth, quailEmail: session.quailEmail,
        items, tz: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
    } catch (e) { quailError = e.message || String(e); }
  } else {
    quailError = 'Not signed in to Quail — no register data.';
  }

  const meta = {
    fetchedAt: Date.now(), count: items.length, quailError,
    quailSales: quail ? quail.sales.length : 0,
    account: accountId, accounts: session.accounts, user: session.username
  };
  writeCache({ items, meta, venues, quail });
  return { ok: true, items, meta, venues, quail };
}

/** popup.js's send(), served locally. Same message names, same return shapes. */
export async function webSend(type, payload = {}) {
  try {
    switch (type) {
      case 'ping':
        return { ok: true, build: WEB_BUILD };
      case 'getSession': {
        const s = load();
        return s && s.sandpiperToken
          ? { ok: true, accounts: s.accounts, user: s.username }
          : { ok: false, error: 'Sign in to continue.', code: 'NO_SESSION' };
      }
      case 'getCache': {
        const c = readCache();
        return c ? { ok: true, ...c } : { ok: true, items: [], meta: null };
      }
      case 'refresh':
        return await doRefresh();
      case 'setAccount':
        load(); session.accountId = payload.accountId; persist();
        return await doRefresh();
      case 'createItems': {
        if (!Array.isArray(payload.rows) || !payload.rows.length) return { ok: false, error: 'Nothing to add.' };
        const { results, created, born } = await core.createItems({
          request, accountId: session.accountId, token: session.sandpiperToken, rows: payload.rows
        });
        const c = readCache() || { items: [] };
        c.items = [...born, ...(c.items || [])];
        if (created) writeCache(c);
        return { ok: true, results, created, items: c.items };
      }
      case 'applyEdits': {
        if (!Array.isArray(payload.plans) || !payload.plans.length) return { ok: false, error: 'Nothing to apply.' };
        const c = readCache() || { items: [] };
        const byId = new Map((c.items || []).map((r) => [r.id, r]));
        const { results, written } = await core.applyEdits({
          request, accountId: session.accountId, token: session.sandpiperToken, plans: payload.plans, byId
        });
        for (const w of written) {
          const idx = (c.items || []).findIndex((r) => r.id === w.id);
          if (idx >= 0) c.items[idx] = w;
        }
        if (written.length) writeCache(c);
        return { ok: true, results, applied: results.filter((r) => r.ok).length, items: c.items };
      }
      case 'deleteItems': {
        if (!Array.isArray(payload.ids) || !payload.ids.length) return { ok: false, error: 'Nothing to delete.' };
        const c = readCache() || { items: [] };
        const { results, gone } = await core.deleteItems({
          request, accountId: session.accountId, token: session.sandpiperToken, ids: payload.ids
        });
        c.items = (c.items || []).filter((r) => !gone.has(r.id));
        if (gone.size) writeCache(c);
        return { ok: true, results, deleted: gone.size, items: c.items };
      }
      default:
        return { ok: false, error: 'Unknown message type.' };
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e), code: e.code || null };
  }
}
