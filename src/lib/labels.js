/**
 * The label stocks Sandpiper's barcode UI offers, taken verbatim from its own
 * bundle. Sandpiper renders the file server-side (see core.generateBarcodes);
 * we only choose a stock and it maps to the request the API wants.
 *
 * The generate-ids payload, as Sandpiper builds it:
 *   template : always one of the SHEET keys below (even for Label / Code List —
 *              it defaults to "30up").
 *   pageSize : sent ONLY in Label mode, as the chosen label's { width, height }
 *              in millimetres; omitted otherwise.
 *   printAll : true only for the Code List ("OTHER") printer type.
 */

export const SHEET_TEMPLATES = {
  letter: [
    { key: '20up', name: '4" × 1"',       count: 20 },
    { key: '30up', name: '2-5/8" × 1"',   count: 30 },
    { key: '60up', name: '1-3/4" × 2/3"', count: 60 },
    { key: '80up', name: '1-3/4" × 1/2"', count: 80, warning: 'small' }
  ],
  a4: [
    { key: 'a4_35x35', name: '35 × 35mm', count: 35 },
    { key: 'a4_38x21', name: '38 × 21mm', count: 65 },
    { key: 'a4_36x17', name: '36 × 17mm', count: 80 },
    { key: 'a4_46x21', name: '46 × 21mm', count: 48 },
    { key: 'a4_26x16', name: '26 × 16mm', count: 90, warning: 'small' }
  ]
};

export const LABEL_TEMPLATES = [
  { key: '2.25x1.25', name: '2-1/4" × 1-1/4"', size: { width: 57.15, height: 31.75 } },
  { key: '2.4x1.1',   name: '2.4" × 1.1"',     size: { width: 62, height: 29 }, note: 'Brother' },
  { key: '2x1',       name: '2" × 1"',         size: { width: 50.8, height: 25.4 } },
  { key: '1x1',       name: '1" × 1"',         size: { width: 25.4, height: 25.4 } },
  { key: '1x1/2',     name: '1" × 1/2"',       size: { width: 25.4, height: 12.7 } },
  { key: '40x30',     name: '40 × 30mm',       size: { width: 40, height: 30 } },
  { key: '30x20',     name: '30 × 20mm',       size: { width: 30, height: 20 } },
  { key: '20x30',     name: '20 × 30mm',       size: { width: 20, height: 30 } },
  { key: '20x10',     name: '20 × 10mm',       size: { width: 20, height: 10 } }
];

// Sandpiper's default sheet, sent as `template` when the mode has no sheet of
// its own (Label, Code List).
export const DEFAULT_SHEET_KEY = '30up';

export function findSheet(family, key) {
  const list = SHEET_TEMPLATES[family] || SHEET_TEMPLATES.letter;
  return list.find((t) => t.key === key) || list[0];
}
export function findLabel(key) {
  return LABEL_TEMPLATES.find((t) => t.key === key) || LABEL_TEMPLATES[0];
}

/** Booth/vendor code for the tag — the "AGM" line on a Sandpiper tag. */
export function defaultVendor(user) {
  const s = String(user || '').trim();
  if (!s) return '';
  const words = s.split(/[\s._-]+/).filter(Boolean);
  const code = words.length > 1 ? words.map((w) => w[0]).join('') : s.slice(0, 3);
  return code.toUpperCase().slice(0, 6);
}
