/**
 * Code 128 barcodes, drawn as SVG. No dependency — the page loads no third-party
 * scripts, and this is small.
 *
 * Sandpiper prints its tags as Code 128 (it calls them "128A-formatted") and
 * encodes the inventory number, which is the value the register stores and the
 * reconciliation joins on. Matching that means a tag printed here scans and
 * reconciles exactly like a Sandpiper one. We encode in code set B — a scanner
 * decodes B, A and C to the same characters, and B covers the digits and
 * letters an inventory number uses.
 */

/* The 107 Code 128 symbol patterns, index 0-106. Each is the run of bar/space
 * module widths; 103-105 are the start codes, 106 the stop. */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];
const START_B = 104;
const STOP = 106;

/** Encode a string to Code 128B, returning the full run of module widths. */
function encode128B(text) {
  const codes = [START_B];
  for (const ch of String(text)) {
    const v = ch.charCodeAt(0) - 32;      // set B covers ASCII 32-126
    if (v < 0 || v > 94) throw new Error(`Code 128 cannot encode ${JSON.stringify(ch)}`);
    codes.push(v);
  }
  let sum = START_B;
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103);                    // checksum
  codes.push(STOP);
  return codes.map((c) => PATTERNS[c]).join('');
}

/** True when a value can be turned into a barcode at all. */
export function canBarcode(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return [...s].every((ch) => { const v = ch.charCodeAt(0) - 32; return v >= 0 && v <= 94; });
}

/**
 * An <svg> string for the value. `module` is the width of one bar unit; `height`
 * the bar height; `quiet` the mandatory white margin either side, in modules.
 * All in the SVG's own units, so the tag CSS scales it.
 */
export function barcodeSVG(text, { height = 40, module = 1.7, quiet = 10 } = {}) {
  const runs = encode128B(text);
  const q = quiet * module;
  let x = q;
  let bar = true;
  let rects = '';
  for (const ch of runs) {
    const w = Number(ch) * module;
    if (bar) rects += `<rect x="${round(x)}" y="0" width="${round(w)}" height="${height}"/>`;
    x += w;
    bar = !bar;
  }
  const total = x + q;
  return `<svg class="bc" viewBox="0 0 ${round(total)} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Barcode ${escapeAttr(text)}">`
    + `<rect width="${round(total)}" height="${height}" fill="#fff"/>`
    + `<g fill="#000">${rects}</g></svg>`;
}

const round = (n) => Math.round(n * 100) / 100;
const escapeAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
