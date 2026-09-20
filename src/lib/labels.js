/**
 * The label stocks Sandpiper can render, mapped to what its barcode API wants:
 * a `template` id and a `pageSize` in millimetres. Sandpiper does the layout and
 * barcode drawing server-side (see core.generateBarcodes); we only pick a stock.
 *
 * Confirmed against a live request: the 2" × 1" label posts
 * `template: "30up"`, `pageSize: { width: 50.8, height: 25.4 }`. The sheet
 * templates follow Sandpiper's "<count>up" naming (20/30/60/80 per US-Letter
 * sheet); the A4 and other label ids are our best mapping and easy to correct
 * here in one place if a stock comes back rejected.
 */

const IN = 25.4; // inches → mm
const mm = (w, h) => ({ width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100 });

export const SHEET_TEMPLATES = {
  letter: [
    { id: 'us-4x1',      name: '4" × 1"',       template: '20up', per: 20, pageSize: mm(4 * IN, 1 * IN) },
    { id: 'us-2.625x1',  name: '2-5/8" × 1"',   template: '30up', per: 30, pageSize: mm(2.625 * IN, 1 * IN) },
    { id: 'us-1.75x.67', name: '1-3/4" × 2/3"', template: '60up', per: 60, pageSize: mm(1.75 * IN, 0.6667 * IN) },
    { id: 'us-1.75x.5',  name: '1-3/4" × 1/2"', template: '80up', per: 80, pageSize: mm(1.75 * IN, 0.5 * IN) }
  ],
  a4: [
    { id: 'a4-35x35', name: '35 × 35mm', template: '35up',  per: 35,  pageSize: mm(35, 35) },
    { id: 'a4-38x21', name: '38 × 21mm', template: '65up',  per: 65,  pageSize: mm(38.1, 21.2) },
    { id: 'a4-36x17', name: '36 × 17mm', template: '75up',  per: 75,  pageSize: mm(36, 17) },
    { id: 'a4-46x21', name: '46 × 21mm', template: '48up',  per: 48,  pageSize: mm(46, 21) },
    { id: 'a4-26x16', name: '26 × 16mm', template: '119up', per: 119, pageSize: mm(26, 16) }
  ]
};

export const LABEL_TEMPLATES = [
  { id: 'lp-2.25x1.25', name: '2-1/4" × 1-1/4"', template: 'label', pageSize: mm(2.25 * IN, 1.25 * IN) },
  { id: 'lp-2.4x1.1',   name: '2.4" × 1.1"',     template: 'label', pageSize: mm(2.4 * IN, 1.1 * IN), note: 'Brother' },
  { id: 'lp-2x1',       name: '2" × 1"',         template: '30up',  pageSize: mm(2 * IN, 1 * IN) }, // confirmed
  { id: 'lp-1x1',       name: '1" × 1"',         template: 'label', pageSize: mm(1 * IN, 1 * IN) },
  { id: 'lp-1x.5',      name: '1" × 1/2"',       template: 'label', pageSize: mm(1 * IN, 0.5 * IN) },
  { id: 'lp-40x30',     name: '40 × 30mm',       template: 'label', pageSize: mm(40, 30) },
  { id: 'lp-30x20',     name: '30 × 20mm',       template: 'label', pageSize: mm(30, 20) },
  { id: 'lp-20x30',     name: '20 × 30mm',       template: 'label', pageSize: mm(20, 30) },
  { id: 'lp-20x10',     name: '20 × 10mm',       template: 'label', pageSize: mm(20, 10) }
];

export function findSheet(family, id) {
  const list = SHEET_TEMPLATES[family] || SHEET_TEMPLATES.letter;
  return list.find((t) => t.id === id) || list[0];
}
export function findLabel(id) {
  return LABEL_TEMPLATES.find((t) => t.id === id) || LABEL_TEMPLATES[0];
}

/** Booth/vendor initials for the tag — the "AGM" line on a Sandpiper tag. */
export function defaultVendor(user) {
  const s = String(user || '').trim();
  if (!s) return '';
  const words = s.split(/[\s._-]+/).filter(Boolean);
  const code = words.length > 1 ? words.map((w) => w[0]).join('') : s.slice(0, 3);
  return code.toUpperCase().slice(0, 6);
}
