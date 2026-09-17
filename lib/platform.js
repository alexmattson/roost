/**
 * One seam between popup.js and the two worlds it runs in.
 *
 * In the extension, storage is chrome.storage.local, `send` crosses to the
 * background worker, and the version comes from the manifest. On the web, the
 * same calls resolve to localStorage, an inline dispatcher, and a constant.
 * popup.js reads `platform` and never learns which it got.
 *
 * The world is chosen once, here, by whether a real extension runtime is
 * present — a plain web page has no chrome.runtime.id.
 */

import { webSend, WEB_BUILD } from './webbackend.js';

export const IS_EXTENSION =
  typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
export const IS_WEB = !IS_EXTENSION;

/* localStorage, shaped like chrome.storage.local: get takes a string or an
 * array of keys and answers with an object; set takes an object; remove takes a
 * key. Async, so the two are interchangeable at the call site. */
const webStorage = {
  async get(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const k of list) {
      try {
        const raw = localStorage.getItem(k);
        if (raw != null) out[k] = JSON.parse(raw);
      } catch (e) { /* a bad entry is simply absent */ }
    }
    return out;
  },
  async set(obj) {
    for (const [k, v] of Object.entries(obj)) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota or private mode */ }
    }
  },
  async remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
};

const extensionPlatform = {
  isWeb: false,
  version: () => chrome.runtime.getManifest().version,
  storage: {
    get: (keys) => chrome.storage.local.get(keys),
    set: (obj) => chrome.storage.local.set(obj),
    remove: (key) => chrome.storage.local.remove(key)
  },
  send: (type, payload) =>
    new Promise((resolve) => chrome.runtime.sendMessage({ type, ...payload }, resolve)),
  openFull: () => chrome.tabs.create({ url: chrome.runtime.getURL('index.html?full=1') })
};

const webPlatform = {
  isWeb: true,
  version: () => WEB_BUILD,
  storage: webStorage,
  send: (type, payload) => webSend(type, payload || {}),
  openFull: () => { /* the web app is already full-width */ }
};

export const platform = IS_EXTENSION ? extensionPlatform : webPlatform;
