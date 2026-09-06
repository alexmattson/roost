/* Sandpiper Analytics — service worker.
 * Owns auth (session cookie -> bearer token + account id) and the API fetch,
 * so a long request survives the popup being closed. */

// Compared against the manifest version by the popup to detect a stale worker.
// MV3 caches the service worker: popup files reload on every open, this file does
// not, so an un-reloaded extension silently runs old logic here.
const BUILD = '1.2.0';

const API_HOST = 'https://app.sandpiperhq.com';
const SESSION_COOKIE = 'sandpiper_s';
const USER_COOKIE = 'sandpiper_u';
const PERMISSIONS_CLAIM = '@app-claim/@sandpiper/permissions';

const STORE = {
  items: 'sp_items', meta: 'sp_meta', account: 'sp_account', venues: 'sp_venues', quail: 'sp_quail'
};

/* Quail is the POS behind the stores Sandpiper's stock sells through. It runs on
 * a separate domain with its own session: the app sends
 * `Authorization: Basic base64(<vendor email>:<session id>)`, both halves of
 * which are readable from its cookies. */
const QUAIL_HOST = 'https://vendor.quailhq.com';
const QUAIL_EMAIL_COOKIE = 'QUAIL_VENDOR_EMAIL';
const QUAIL_SESSION_COOKIE = 'QUAIL_VENDOR_SESSION';
const MAX_RENT_MONTHS = 36;

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

async function getCookie(name, url = API_HOST) {
  try {
    const c = await chrome.cookies.get({ url, name });
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
async function requestDirect(url, authorization, { method = 'GET', body = null } = {}) {
  const headers = { Accept: 'application/json', authorization };
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
async function requestViaPage(url, authorization, { method = 'GET', body = null } = {}) {
  const origin = new URL(url).origin;
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  if (!tabs.length) {
    const err = new Error(`Open a tab on ${new URL(url).hostname} and try again.`);
    err.code = 'NO_TAB';
    throw err;
  }
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    args: [url, authorization, method, body],
    func: async (target, auth, verb, payload) => {
      try {
        const headers = { Accept: 'application/json', authorization: auth };
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

async function apiRequest(url, authorization, init) {
  try {
    return await requestDirect(url, authorization, init);
  } catch (directError) {
    // A 401/403 usually means the session really is bad — but it can also be an
    // Origin check, so give the in-page path one shot before giving up.
    try {
      return await requestViaPage(url, authorization, init);
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
async function fetchVenues(authorization, accountId) {
  const stores = {};
  const booths = {};
  const errors = [];

  const [storeRes, boothRes] = await Promise.allSettled([
    apiRequest(`${API_HOST}/api/stores/${accountId}`, authorization),
    apiRequest(`${API_HOST}/api/booths/${accountId}`, authorization)
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

async function readQuailSession() {
  const rawEmail = await getCookie(QUAIL_EMAIL_COOKIE, QUAIL_HOST);
  const session = await getCookie(QUAIL_SESSION_COOKIE, QUAIL_HOST);
  if (!rawEmail || !session) {
    const err = new Error('Not signed in to vendor.quailhq.com — open it, sign in, then fetch again.');
    err.code = 'NO_QUAIL_SESSION';
    throw err;
  }
  const email = decodeURIComponent(rawEmail);
  return { email, session, authorization: `Basic ${btoa(`${email}:${session}`)}` };
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Calendar months spanned by [from, to], as {start,end} date strings. */
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
 * Pulls POS sales, booth terms, rent and Quail's own monthly statement.
 * The statement totals are kept so the dashboard can check its arithmetic
 * against Quail's rather than just trusting the line items.
 */
async function fetchQuail(items) {
  const q = await readQuailSession();
  const auth = q.authorization;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  const tzParam = encodeURIComponent(tz);

  // Cover everything Sandpiper knows about, capped so the month loop stays bounded.
  const stamps = items
    .map((i) => Number(i.acquired) || 0)
    .filter(Boolean)
    .map((s) => s * 1000);
  const earliest = stamps.length ? new Date(Math.min(...stamps)) : new Date(Date.now() - 365 * 86400000);
  const floor = new Date(Date.now() - MAX_RENT_MONTHS * 31 * 86400000);
  const from = earliest > floor ? earliest : floor;
  const to = new Date(Date.now() + 86400000);
  const start = ymd(from);
  const end = ymd(to);

  const errors = [];
  const booths = await apiRequest(
    `${QUAIL_HOST}/api/portal/booths2?start=${start}&end=${end}&tz=${tzParam}`, auth
  );
  const boothList = Array.isArray(booths) ? booths : [];

  const sales = [];
  const rent = [];
  const months = monthsBetween(from, to);

  for (const booth of boothList) {
    const id = booth.boothId;
    try {
      const rows = await apiRequest(
        `${QUAIL_HOST}/api/portal/booth-items?start=${start}&end=${end}&tz=${tzParam}&b=${id}`, auth
      );
      if (Array.isArray(rows)) sales.push(...rows);
    } catch (e) {
      errors.push(`booth ${id} items: ${e.message}`);
    }

    // Rent is month-scoped, so it needs one call per month.
    const perMonth = await Promise.allSettled(months.map((m) =>
      apiRequest(`${QUAIL_HOST}/api/portal/rent?booth=${id}&start=${m.start}&end=${m.end}&tz=${tzParam}`, auth)
        .then((v) => ({ boothId: id, month: m.key, cents: Math.round(Number(v) || 0) }))));
    for (const r of perMonth) {
      if (r.status === 'fulfilled') rent.push(r.value);
      else errors.push(String(r.reason && r.reason.message || r.reason));
    }
  }

  console.log(`[Sandpiper Analytics] quail: ${sales.length} sale(s) across ${boothList.length} booth(s), `
    + `${months.length} month(s) of rent` + (errors.length ? `, ${errors.length} error(s)` : ''));

  return {
    sales, booths: boothList, rent, errors,
    email: q.email, tz, range: { start, end }, fetchedAt: Date.now()
  };
}

async function fetchItems() {
  const session = await readSession();
  const accountId = await resolveAccountId(session);

  const json = await apiRequest(itemsUrl(accountId), `Bearer ${session.token}`, { method: 'POST', body: ITEMS_BODY });
  const items = Array.isArray(json) ? json : json.items || json.data || json.results || [];
  if (!Array.isArray(items)) throw new Error('Unexpected response shape from the Sandpiper API.');

  // Names are optional: never let a venue failure sink a good item sync, but do
  // report it so the popup can say something rather than silently showing ids.
  let venues = { stores: {}, booths: {}, errors: [] };
  try {
    venues = await fetchVenues(`Bearer ${session.token}`, accountId);
  } catch (e) {
    venues.errors = [e.message || String(e)];
  }

  // Quail is optional: a missing POS session must not block an inventory sync.
  let quail = null;
  let quailError = null;
  try {
    quail = await fetchQuail(items);
  } catch (e) {
    quailError = e.message || String(e);
    console.log(`[Sandpiper Analytics] quail unavailable: ${quailError}`);
  }

  const meta = {
    fetchedAt: Date.now(),
    count: items.length,
    quailError,
    quailSales: quail ? quail.sales.length : 0,
    account: accountId,
    accounts: session.accounts,
    user: session.username
  };
  const payload = {
    [STORE.items]: items,
    [STORE.meta]: meta,
    [STORE.venues]: venues,
    [STORE.account]: accountId
  };
  if (quail) payload[STORE.quail] = quail;
  await chrome.storage.local.set(payload);
  return { items, meta, venues, quail };
}

async function readCache() {
  const data = await chrome.storage.local.get([STORE.items, STORE.meta, STORE.venues, STORE.quail]);
  return {
    items: data[STORE.items] || null,
    meta: data[STORE.meta] || null,
    venues: data[STORE.venues] || { stores: {}, booths: {} },
    quail: data[STORE.quail] || null
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
