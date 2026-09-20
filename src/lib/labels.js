/**
 * Label / tag layouts, mirroring the variants Sandpiper prints.
 *
 * Three printer types:
 *   - sheet    : barcodes tiled onto a die-cut sheet of address labels
 *                (US Letter or A4), fed through a normal desktop printer.
 *   - label    : one tag per page for a dedicated roll/label printer.
 *   - codelist : a downloadable file of barcode data for a printer's own
 *                software to render (no page layout involved).
 *
 * Sheet and label templates carry true physical geometry so the preview is the
 * print. Everything is expressed in the template's own `unit` (in or mm); the
 * page is drawn at real size and only scaled for the on-screen preview.
 */

// px per physical unit at CSS 96dpi — used only to scale the preview.
export const PX_PER = { in: 96, mm: 96 / 25.4 };

/* Sheets: symmetric side margins, so only the top margin and gaps are stored;
   the left margin is derived to centre the grid on the page. */
function sheet(id, name, unit, page, cols, rows, cell, gap, marginTop) {
  const [pw, ph] = page;
  const [cw, ch] = cell;
  const [gx, gy] = gap;
  const marginLeft = (pw - cols * cw - (cols - 1) * gx) / 2;
  return { id, name, unit, page: { w: pw, h: ph }, cols, rows,
    cell: { w: cw, h: ch }, gap: { x: gx, y: gy },
    margin: { top: marginTop, left: marginLeft }, per: cols * rows };
}

export const SHEET_TEMPLATES = {
  letter: [
    sheet('us-4x1',      '4" × 1"',        'in', [8.5, 11], 2, 10, [4, 1],          [0.1875, 0], 0.5),
    sheet('us-2.625x1',  '2-5/8" × 1"',    'in', [8.5, 11], 3, 10, [2.625, 1],      [0.125, 0],  0.5),
    sheet('us-1.75x.67', '1-3/4" × 2/3"',  'in', [8.5, 11], 4, 15, [1.75, 0.6667],  [0.3, 0],    0.5),
    sheet('us-1.75x.5',  '1-3/4" × 1/2"',  'in', [8.5, 11], 4, 20, [1.75, 0.5],     [0.3, 0],    0.5)
  ],
  a4: [
    sheet('a4-35x35', '35 × 35mm', 'mm', [210, 297], 5,  7, [35, 35],     [2.5, 2.5], 18.5),
    sheet('a4-38x21', '38 × 21mm', 'mm', [210, 297], 5, 13, [38.1, 21.2], [2.5, 0],   10.7),
    sheet('a4-36x17', '36 × 17mm', 'mm', [210, 297], 5, 15, [36, 17],     [2.5, 0],   21),
    sheet('a4-46x21', '46 × 21mm', 'mm', [210, 297], 4, 12, [46, 21],     [2.5, 0],   22.5),
    sheet('a4-26x16', '26 × 16mm', 'mm', [210, 297], 7, 17, [26, 16],     [1.5, 0],   12.5)
  ]
};

/* Dedicated-printer stock: one tag per page. */
export const LABEL_TEMPLATES = [
  { id: 'lp-2.25x1.25', name: '2-1/4" × 1-1/4"',       unit: 'in', w: 2.25, h: 1.25 },
  { id: 'lp-2.4x1.1',   name: '2.4" × 1.1"',           unit: 'in', w: 2.4,  h: 1.1, note: 'Brother' },
  { id: 'lp-2x1',       name: '2" × 1"',               unit: 'in', w: 2,    h: 1 },
  { id: 'lp-1x1',       name: '1" × 1"',               unit: 'in', w: 1,    h: 1 },
  { id: 'lp-1x.5',      name: '1" × 1/2"',             unit: 'in', w: 1,    h: 0.5 },
  { id: 'lp-40x30',     name: '40 × 30mm',             unit: 'mm', w: 40,   h: 30 },
  { id: 'lp-30x20',     name: '30 × 20mm',             unit: 'mm', w: 30,   h: 20 },
  { id: 'lp-20x30',     name: '20 × 30mm',             unit: 'mm', w: 20,   h: 30 },
  { id: 'lp-20x10',     name: '20 × 10mm',             unit: 'mm', w: 20,   h: 10 }
];

export function findSheet(family, id) {
  const list = SHEET_TEMPLATES[family] || [];
  return list.find((t) => t.id === id) || list[0];
}
export function findLabel(id) {
  return LABEL_TEMPLATES.find((t) => t.id === id) || LABEL_TEMPLATES[0];
}

/** Break a flat list into fixed-size pages (for sheet pagination). */
export function paginate(list, per) {
  const pages = [];
  for (let i = 0; i < list.length; i += per) pages.push(list.slice(i, i + per));
  return pages;
}

/** The @page size keyword or explicit dimensions for a template. */
export function pageSize(t, kind) {
  if (kind === 'sheet') return t.page.w === 210 ? 'A4' : 'letter';
  return `${t.w}${t.unit} ${t.h}${t.unit}`;
}

/** Booth/vendor initials for the tag — the "AGM" line on a Sandpiper tag. */
export function defaultVendor(user) {
  const s = String(user || '').trim();
  if (!s) return '';
  const words = s.split(/[\s._-]+/).filter(Boolean);
  const code = words.length > 1
    ? words.map((w) => w[0]).join('')
    : s.slice(0, 3);
  return code.toUpperCase().slice(0, 4);
}
