/* Sandpiper Analytics — service worker.
 * Owns auth (session cookie -> bearer token + account id) and the API fetch,
 * so a long request survives the popup being closed. */

// Compared against the manifest version by the popup to detect a stale worker.
// MV3 caches the service worker: popup files reload on every open, this file does
// not, so an un-reloaded extension silently runs old logic here.
const BUILD = '1.1.0';

const API_HOST = 'https://app.sandpiperhq.com';
const SESSION_COOKIE = 'sandpiper_s';
const USER_COOKIE = 'sandpiper_u';
const PERMISSIONS_CLAIM = '@app-claim/@sandpiper/permissions';

const STORE = { items: 'sp_items', meta: 'sp_meta', account: 'sp_account', venues: 'sp_venues' };

function b64urlDecode(part) {
  const pad = part.replace(/-/g, '+').replace(/_/g, '/');
  const str = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  // handle utf-8 payloads
  return decodeURIComponent(
    str.split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  );
}

function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Session token is malformed.');
  return JSON.parse(b64urlDecode(parts[1]));
}

async function getCookie(name) {
  try {
    const c = await chrome.cookies.get({ url: API_HOST, name });
    return c && c.value ? c.value : null;
  } catch (e) {
    return null;
  }
}

/** Reads the logged-in Sandpiper session straight out of the browser's cookie jar. */
async function readSession() {
  const token = await getCookie(SESSION_COOKIE);
  if (!token) {
    const err = new Error('No Sandpiper session found. Open app.sandpiperhq.com and sign in, then try again.');
    err.code = 'NO_SESSION';
    throw err;
  }
  let claims;
  try {
    claims = decodeJwt(token);
  } catch (e) {
    const err = new Error('Could not read the Sandpiper session token.');
    err.code = 'BAD_TOKEN';
    throw err;
  }
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    const err = new Error('Your Sandpiper session has expired. Sign in again, then retry.');
    err.code = 'EXPIRED';
    throw err;
  }
  let accounts = [];
  try {
    const raw = claims[PERMISSIONS_CLAIM];
    const perms = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
    accounts = Array.isArray(perms.accounts) ? perms.accounts : [];
  } catch (e) { /* fall through to the manual override */ }

  const username = claims.username || (await getCookie(USER_COOKIE)) || '';
  return { token, accounts, username: decodeURIComponent(username) };
}

async function resolveAccountId(session) {
  const stored = (await chrome.storage.local.get(STORE.account))[STORE.account];
  if (stored && (session.accounts.length === 0 || session.accounts.includes(stored))) return stored;
  if (session.accounts.length) return session.accounts[0];
  const err = new Error('No Sandpiper account was found on this session.');
  err.code = 'NO_ACCOUNT';
  throw err;
}

const ITEMS_BODY = { filters: [], orderBy: 'ACQUIRED', reverse: true };
const itemsUrl = (accountId) => `${API_HOST}/api/items/v2/${accountId}/items?from=0&to=10000000`;

/** Primary path: request straight from the service worker using the session cookie + bearer token. */
async function requestDirect(url, token, { method = 'GET', body = null } = {}) {
  const headers = { Accept: 'application/json', authorization: `Bearer ${token}` };
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = new Error(`Sandpiper API returned ${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Fallback: run the same request inside an open Sandpiper tab, so it goes out
 * same-origin. Used only if the direct call fails (e.g. the API checks Origin).
 */
async function requestViaPage(url, token, { method = 'GET', body = null } = {}) {
  const tabs = await chrome.tabs.query({ url: `${API_HOST}/*` });
  if (!tabs.length) {
    const err = new Error('Open a tab on app.sandpiperhq.com and try again.');
    err.code = 'NO_TAB';
    throw err;
  }
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    args: [url, token, method, body],
    func: async (target, bearer, verb, payload) => {
      try {
        const headers = { Accept: 'application/json', authorization: `Bearer ${bearer}` };
        if (payload) headers['content-type'] = 'application/json';
        const r = await fetch(target, {
          method: verb,
          credentials: 'include',
          headers,
          body: payload ? JSON.stringify(payload) : undefined
        });
        if (!r.ok) return { ok: false, error: `Sandpiper API returned ${r.status} ${r.statusText}` };
        return { ok: true, data: await r.json() };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
  });
  const result = injection && injection.result;
  if (!result || !result.ok) throw new Error((result && result.error) || 'The in-page request failed.');
  return result.data;
}

async function apiRequest(url, token, init) {
  try {
    return await requestDirect(url, token, init);
  } catch (directError) {
    // A 401/403 usually means the session really is bad — but it can also be an
    // Origin check, so give the in-page path one shot before giving up.
    try {
      return await requestViaPage(url, token, init);
    } catch (pageError) {
      if (directError.status === 401 || directError.status === 403) {
        // Name the path: a 403 here can mean an expired session OR a resource this
        // account can't read, and conflating the two sends you down the wrong path.
        let path = url;
        try {
          path = new URL(url).pathname;
        } catch (e) { /* keep the full url */ }
        const err = new Error(`Sandpiper returned ${directError.status} for ${path}. `
          + 'If this persists, sign in again at app.sandpiperhq.com.');
        err.code = 'UNAUTHORIZED';
        err.status = directError.status;
        throw err;
      }
      directError.message = `${directError.message} (fallback: ${pageError.message})`;
      throw directError;
    }
  }
}

const asArray = (payload) => (Array.isArray(payload) ? payload : payload ? [payload] : []);

/**
 * Resolves store/booth names. Both endpoints are account-scoped LIST endpoints —
 * /api/stores/<accountId> and /api/booths/<accountId> return every venue on the
 * account. Passing a store or booth id here returns 403.
 * Cosmetic, so a failure must never sink an otherwise good item sync.
 */
async function fetchVenues(token, accountId) {
  const stores = {};
  const booths = {};
  const errors = [];

  const [storeRes, boothRes] = await Promise.allSettled([
    apiRequest(`${API_HOST}/api/stores/${accountId}`, token),
    apiRequest(`${API_HOST}/api/booths/${accountId}`, token)
  ]);

  if (storeRes.status === 'fulfilled') {
    for (const v of asArray(storeRes.value)) {
      if (v && v.id) stores[v.id] = { name: v.name || null, city: v.city || null, state: v.state || null };
    }
  } else {
    errors.push(`stores: ${storeRes.reason && storeRes.reason.message || storeRes.reason}`);
  }

  if (boothRes.status === 'fulfilled') {
    for (const v of asArray(boothRes.value)) {
      if (!v || !v.id) continue;
      booths[v.id] = {
        name: v.name || null,
        storeId: v.storeId || null,
        // Sent as hundredths of a percent: 1500 => 15%.
        consignmentRate: typeof v.consignmentRate === 'number' ? v.consignmentRate / 10000 : null
      };
    }
  } else {
    errors.push(`booths: ${boothRes.reason && boothRes.reason.message || boothRes.reason}`);
  }

  console.log(`[Sandpiper Analytics] venues: ${Object.keys(stores).length} store(s), ` +
    `${Object.keys(booths).length} booth(s)` + (errors.length ? ` — ${errors.join('; ')}` : ''));
  return { stores, booths, errors, fetchedAt: Date.now() };
}

async function fetchItems() {
  const session = await readSession();
  const accountId = await resolveAccountId(session);

  const json = await apiRequest(itemsUrl(accountId), session.token, { method: 'POST', body: ITEMS_BODY });
  const items = Array.isArray(json) ? json : json.items || json.data || json.results || [];
  if (!Array.isArray(items)) throw new Error('Unexpected response shape from the Sandpiper API.');

  // Names are optional: never let a venue failure sink a good item sync, but do
  // report it so the popup can say something rather than silently showing ids.
  let venues = { stores: {}, booths: {}, errors: [] };
  try {
    venues = await fetchVenues(session.token, accountId);
  } catch (e) {
    venues.errors = [e.message || String(e)];
  }

  const meta = {
    fetchedAt: Date.now(),
    count: items.length,
    account: accountId,
    accounts: session.accounts,
    user: session.username
  };
  await chrome.storage.local.set({
    [STORE.items]: items,
    [STORE.meta]: meta,
    [STORE.venues]: venues,
    [STORE.account]: accountId
  });
  return { items, meta, venues };
}

async function readCache() {
  const data = await chrome.storage.local.get([STORE.items, STORE.meta, STORE.venues]);
  return {
    items: data[STORE.items] || null,
    meta: data[STORE.meta] || null,
    venues: data[STORE.venues] || { stores: {}, booths: {} }
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'refresh':
          sendResponse({ ok: true, ...(await fetchItems()) });
          break;
        case 'getCache':
          sendResponse({ ok: true, ...(await readCache()) });
          break;
        case 'ping':
          sendResponse({ ok: true, build: BUILD });
          break;
        case 'getSession': {
          const s = await readSession();
          sendResponse({ ok: true, accounts: s.accounts, user: s.username });
          break;
        }
        case 'setAccount':
          await chrome.storage.local.set({ [STORE.account]: msg.accountId });
          sendResponse({ ok: true, ...(await fetchItems()) });
          break;
        default:
          sendResponse({ ok: false, error: 'Unknown message type.' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e), code: e.code || null });
    }
  })();
  return true; // async response
});
