/* Roost — dependency-free SVG charts.
 * Extension CSP forbids remote scripts, so everything here is hand-rolled. */

const NS = 'http://www.w3.org/2000/svg';

/* Dark values are the defaults; refreshPalette() re-reads them from CSS custom
 * properties so every chart follows the active theme. Both objects are mutated
 * in place, because importers hold these references. */
export const PALETTE = {
  brass: '#f0b429',
  brassSoft: '#fbd38d',
  green: '#34d399',
  red: '#f87171',
  blue: '#60a5fa',
  purple: '#a78bfa',
  teal: '#2dd4bf',
  pink: '#f472b6',
  grid: 'rgba(255,255,255,.07)',
  axis: '#8b93a7',
  hairline: 'rgba(255,255,255,.22)',
  surface: '#14161d'
};

const PALETTE_VARS = {
  brass: '--chart-brass',
  brassSoft: '--chart-brass-soft',
  green: '--chart-green',
  red: '--chart-red',
  blue: '--chart-blue',
  purple: '--chart-purple',
  teal: '--chart-teal',
  pink: '--chart-pink',
  grid: '--chart-grid',
  axis: '--chart-axis',
  hairline: '--chart-hairline',
  surface: '--chart-surface'
};

export const SERIES_COLORS = [
  PALETTE.brass, PALETTE.green, PALETTE.blue, PALETTE.purple,
  PALETTE.pink, PALETTE.teal, PALETTE.red, PALETTE.brassSoft
];

/** Pulls the current theme's chart colours out of CSS. Call before rendering. */
export function refreshPalette() {
  if (typeof document === 'undefined') return PALETTE;
  const cs = getComputedStyle(document.documentElement);
  for (const [key, cssVar] of Object.entries(PALETTE_VARS)) {
    const value = cs.getPropertyValue(cssVar).trim();
    if (value) PALETTE[key] = value;
  }
  SERIES_COLORS.splice(0, SERIES_COLORS.length,
    PALETTE.brass, PALETTE.green, PALETTE.blue, PALETTE.purple,
    PALETTE.pink, PALETTE.teal, PALETTE.red, PALETTE.brassSoft);
  return PALETTE;
}

/* ------------------------------------------------------------ formatting */

export function money(cents, { compact = false, centsPrecision = false } = {}) {
  const v = (cents || 0) / 100;
  const abs = Math.abs(v);
  if (abs < 0.005) return '$0';
  if (compact && abs >= 1000) {
    const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
    for (const [div, suf] of units) {
      if (abs >= div) {
        const n = v / div;
        return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(Math.abs(n) < 10 ? 1 : 0)}${suf}`;
      }
    }
  }
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: centsPrecision || abs < 100 ? 2 : 0,
    maximumFractionDigits: centsPrecision || abs < 100 ? 2 : 0
  });
}

export const pct = (n, digits = 1) =>
  n == null || !isFinite(n) ? '—' : `${(n * 100).toFixed(digits)}%`;

export const int = (n) => (n == null ? '—' : Math.round(n).toLocaleString());

/* ------------------------------------------------------------- primitives */

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(node);
  return node;
}

function niceTicks(min, max, count = 5, integer = false) {
  if (min === max) { min = Math.min(0, min); max = max || 1; }
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  const norm = raw / mag;
  let step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  if (integer) step = Math.max(1, Math.round(step));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return { ticks, lo, hi: ticks[ticks.length - 1] };
}

/* ---------------------------------------------------------------- tooltip */

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    document.body.appendChild(tip);
  }
  return tip;
}

function showTip(html, evt) {
  const t = tooltip();
  t.innerHTML = html;
  t.classList.add('on');
  const pad = 12;
  const rect = t.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + rect.width > window.innerWidth - 6) x = evt.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 6) y = evt.clientY - rect.height - pad;
  t.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
}

export function hideTip() {
  if (tip) tip.classList.remove('on');
}
if (typeof document !== 'undefined') document.addEventListener('scroll', hideTip, true);

/* ------------------------------------------------------------ chart frame */

function frame(container, height, pad) {
  container.innerHTML = '';
  const w = Math.max(260, container.clientWidth || 320);
  const h = height;
  const svg = el('svg', {
    viewBox: `0 0 ${w} ${h}`,
    width: '100%',
    height: h,
    preserveAspectRatio: 'none',
    class: 'chart'
  }, container);
  svg.addEventListener('mouseleave', hideTip);
  return { svg, w, h, pad, iw: w - pad.l - pad.r, ih: h - pad.t - pad.b };
}

function yAxis(f, ticks, fmt) {
  const { svg, pad, iw } = f;
  for (const t of ticks.ticks) {
    const y = f.yScale(t);
    el('line', { x1: pad.l, x2: pad.l + iw, y1: y, y2: y, stroke: PALETTE.grid, 'stroke-width': 1 }, svg);
    el('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-label' }, svg).textContent = fmt(t);
  }
}

function xLabels(f, labels) {
  const { svg, pad, ih } = f;
  const step = Math.ceil(labels.length / Math.max(2, Math.floor(f.iw / 62)));
  labels.forEach((label, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    const x = f.xCenter(i);
    if (i !== labels.length - 1 && labels.length - 1 - i < step * 0.6) return;
    el('text', { x, y: pad.t + ih + 18, 'text-anchor': 'middle', class: 'axis-label' }, svg).textContent = label;
  });
}

export function empty(container, message = 'No data in this range') {
  container.innerHTML = `<div class="chart-empty">${message}</div>`;
}

/* ------------------------------------------------------------- line chart */

export function lineChart(container, opts) {
  const {
    labels = [], series = [], height = 190, yFormat = (v) => money(v, { compact: true }),
    tipFormat = (v) => money(v), area = true, zeroLine = true, integerY = false
  } = opts;
  if (!labels.length || !series.some((s) => s.values.some((v) => v !== 0))) return empty(container);

  const pad = { t: 12, r: 12, b: 26, l: 54 };
  const f = frame(container, height, pad);
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4, integerY);
  f.yScale = (v) => pad.t + f.ih - ((v - ticks.lo) / (ticks.hi - ticks.lo || 1)) * f.ih;
  f.xCenter = (i) => pad.l + (labels.length === 1 ? f.iw / 2 : (i / (labels.length - 1)) * f.iw);

  yAxis(f, ticks, yFormat);
  if (zeroLine && ticks.lo < 0) {
    el('line', {
      x1: pad.l, x2: pad.l + f.iw, y1: f.yScale(0), y2: f.yScale(0),
      stroke: PALETTE.hairline, 'stroke-width': 1
    }, f.svg);
  }

  series.forEach((s, si) => {
    const color = s.color || SERIES_COLORS[si % SERIES_COLORS.length];
    const pts = s.values.map((v, i) => [f.xCenter(i), f.yScale(v)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

    if (area && series.length <= 2) {
      const gid = `grad-${Math.random().toString(36).slice(2, 8)}`;
      const defs = el('defs', {}, f.svg);
      const lg = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      el('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.32 }, lg);
      el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }, lg);
      const base = f.yScale(Math.max(ticks.lo, 0));
      el('path', {
        d: `${d} L${pts[pts.length - 1][0].toFixed(1)} ${base} L${pts[0][0].toFixed(1)} ${base} Z`,
        fill: `url(#${gid})`
      }, f.svg);
    }
    el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.25, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.svg);
  });

  // hover crosshair
  const hover = el('line', { y1: pad.t, y2: pad.t + f.ih, stroke: PALETTE.hairline, 'stroke-width': 1, opacity: 0 }, f.svg);
  const dots = series.map((s, si) =>
    el('circle', { r: 4, fill: s.color || SERIES_COLORS[si % SERIES_COLORS.length], stroke: PALETTE.surface, 'stroke-width': 2, opacity: 0 }, f.svg)
  );
  const hit = el('rect', { x: 0, y: 0, width: f.w, height: f.h, fill: 'transparent' }, f.svg);
  hit.addEventListener('mousemove', (e) => {
    const box = container.getBoundingClientRect();
    const rel = ((e.clientX - box.left) / box.width) * f.w;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(((rel - pad.l) / f.iw) * (labels.length - 1))));
    const x = f.xCenter(i);
    hover.setAttribute('x1', x); hover.setAttribute('x2', x); hover.setAttribute('opacity', 1);
    dots.forEach((dot, si) => {
      dot.setAttribute('cx', x); dot.setAttribute('cy', f.yScale(series[si].values[i])); dot.setAttribute('opacity', 1);
    });
    showTip(
      `<div class="tip-title">${labels[i]}</div>` +
      series.map((s, si) =>
        `<div class="tip-row"><span class="dot" style="background:${s.color || SERIES_COLORS[si % SERIES_COLORS.length]}"></span>${s.name}<b>${tipFormat(s.values[i], s, i)}</b></div>`
      ).join(''), e);
  });
  hit.addEventListener('mouseleave', () => {
    hover.setAttribute('opacity', 0);
    dots.forEach((d) => d.setAttribute('opacity', 0));
    hideTip();
  });

  xLabels(f, labels);
  return f.svg;
}

/* -------------------------------------------------------------- bar chart */

export function barChart(container, opts) {
  const {
    labels = [], series = [], height = 190, yFormat = (v) => money(v, { compact: true }),
    tipFormat = (v) => money(v), stacked = false, integerY = false
  } = opts;
  if (!labels.length || !series.some((s) => s.values.some((v) => v !== 0))) return empty(container);

  const pad = { t: 12, r: 12, b: 26, l: 54 };
  const f = frame(container, height, pad);

  const totals = labels.map((_, i) =>
    stacked ? series.reduce((a, s) => a + Math.max(0, s.values[i]), 0) : Math.max(...series.map((s) => s.values[i]))
  );
  const mins = labels.map((_, i) => Math.min(0, ...series.map((s) => s.values[i])));
  const ticks = niceTicks(Math.min(0, ...mins), Math.max(0, ...totals), 4, integerY);
  f.yScale = (v) => pad.t + f.ih - ((v - ticks.lo) / (ticks.hi - ticks.lo || 1)) * f.ih;

  const slot = f.iw / labels.length;
  const groupW = Math.max(3, Math.min(46, slot * 0.66));
  const barW = stacked ? groupW : Math.max(2, groupW / series.length - 1.5);
  f.xCenter = (i) => pad.l + slot * i + slot / 2;

  yAxis(f, ticks, yFormat);
  const zeroY = f.yScale(0);

  labels.forEach((label, i) => {
    const cx = f.xCenter(i);
    let stackTop = 0;
    series.forEach((s, si) => {
      const color = s.color || SERIES_COLORS[si % SERIES_COLORS.length];
      const v = s.values[i] || 0;
      let x, y, h;
      if (stacked) {
        x = cx - groupW / 2;
        y = f.yScale(stackTop + Math.max(0, v));
        h = Math.abs(f.yScale(0) - f.yScale(Math.abs(v)));
        stackTop += Math.max(0, v);
      } else {
        x = cx - groupW / 2 + si * (barW + 1.5);
        y = v >= 0 ? f.yScale(v) : zeroY;
        h = Math.abs(f.yScale(v) - zeroY);
      }
      el('rect', {
        x, y, width: barW, height: Math.max(v === 0 ? 0 : 1.5, h),
        rx: Math.min(3, barW / 2), fill: color, opacity: v < 0 ? 0.75 : 0.95, class: 'bar'
      }, f.svg);
    });

    const hit = el('rect', { x: cx - slot / 2, y: pad.t, width: slot, height: f.ih, fill: 'transparent' }, f.svg);
    hit.addEventListener('mousemove', (e) =>
      showTip(
        `<div class="tip-title">${label}</div>` +
        series.map((s, si) =>
          `<div class="tip-row"><span class="dot" style="background:${s.color || SERIES_COLORS[si % SERIES_COLORS.length]}"></span>${s.name}<b>${tipFormat(s.values[i], s, i)}</b></div>`
        ).join(''), e));
    hit.addEventListener('mouseleave', hideTip);
  });

  if (ticks.lo < 0) {
    el('line', { x1: pad.l, x2: pad.l + f.iw, y1: zeroY, y2: zeroY, stroke: PALETTE.hairline }, f.svg);
  }
  xLabels(f, labels);
  return f.svg;
}

/* ------------------------------------------------------------------ donut */

export function donut(container, opts) {
  const { segments = [], height = 190, centerLabel = '', centerValue = '', format = (v) => money(v) } = opts;
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  if (!total) return empty(container);

  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'donut-wrap';
  container.appendChild(wrap);
  const svgBox = document.createElement('div');
  svgBox.className = 'donut-svg';
  wrap.appendChild(svgBox);

  const size = height;
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'chart' }, svgBox);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  const inner = r * 0.63;

  let angle = -Math.PI / 2;
  segments.forEach((s, i) => {
    const frac = Math.max(0, s.value) / total;
    const a2 = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x1, y1] = p(r, angle);
    const [x2, y2] = p(r, a2 - 0.0001);
    const [x3, y3] = p(inner, a2 - 0.0001);
    const [x4, y4] = p(inner, angle);
    const color = s.color || SERIES_COLORS[i % SERIES_COLORS.length];
    const path = el('path', {
      d: `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`,
      fill: color, class: 'slice'
    }, svg);
    path.addEventListener('mousemove', (e) =>
      showTip(`<div class="tip-title">${s.label}</div><div class="tip-row"><span class="dot" style="background:${color}"></span>${format(s.value)}<b>${pct(frac, 1)}</b></div>`, e));
    path.addEventListener('mouseleave', hideTip);
    angle = a2;
  });

  el('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'donut-value' }, svg).textContent = centerValue;
  el('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'donut-label' }, svg).textContent = centerLabel;

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = segments.map((s, i) => `
    <div class="legend-row">
      <span class="dot" style="background:${s.color || SERIES_COLORS[i % SERIES_COLORS.length]}"></span>
      <span class="legend-name">${s.label}</span>
      <span class="legend-val">${format(s.value)}</span>
    </div>`).join('');
  wrap.appendChild(legend);
}

/* -------------------------------------------------------- horizontal bars */

export function hbar(container, opts) {
  const { rows = [], format = (v) => money(v), colorFor = null, height = null } = opts;
  if (!rows.length || rows.every((r) => !r.value)) return empty(container);
  container.innerHTML = '';
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const box = document.createElement('div');
  box.className = 'hbar';
  if (height) box.style.minHeight = `${height}px`;
  box.innerHTML = rows.map((r, i) => {
    const color = colorFor ? colorFor(r, i) : SERIES_COLORS[i % SERIES_COLORS.length];
    const w = (Math.abs(r.value) / max) * 100;
    return `
      <div class="hbar-row" title="${(r.sub || '').replace(/"/g, '')}">
        <div class="hbar-label">${r.label}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${w}%;background:${color}"></div></div>
        <div class="hbar-value">${format(r.value)}</div>
      </div>`;
  }).join('');
  container.appendChild(box);
}

/* ---------------------------------------------------------------- scatter */

export function scatter(container, opts) {
  const {
    points = [], height = 200, xFormat = (v) => money(v, { compact: true }),
    yFormat = (v) => money(v, { compact: true }), breakEven = true
  } = opts;
  if (!points.length) return empty(container);

  const pad = { t: 12, r: 14, b: 30, l: 54 };
  const f = frame(container, height, pad);
  const xt = niceTicks(0, Math.max(...points.map((p) => p.x)), 4);
  const yt = niceTicks(0, Math.max(...points.map((p) => p.y)), 4);
  f.yScale = (v) => pad.t + f.ih - ((v - yt.lo) / (yt.hi - yt.lo || 1)) * f.ih;
  const xScale = (v) => pad.l + ((v - xt.lo) / (xt.hi - xt.lo || 1)) * f.iw;

  yAxis(f, yt, yFormat);
  for (const t of xt.ticks) {
    el('text', { x: xScale(t), y: pad.t + f.ih + 18, 'text-anchor': 'middle', class: 'axis-label' }, f.svg).textContent = xFormat(t);
  }

  if (breakEven) {
    const lim = Math.min(xt.hi, yt.hi);
    el('line', {
      x1: xScale(0), y1: f.yScale(0), x2: xScale(lim), y2: f.yScale(lim),
      stroke: PALETTE.red, opacity: 0.55, 'stroke-width': 1.25, 'stroke-dasharray': '4 4'
    }, f.svg);
    el('text', { x: xScale(lim) - 4, y: f.yScale(lim) - 6, 'text-anchor': 'end', class: 'axis-label' }, f.svg).textContent = 'break-even';
  }

  for (const p of points) {
    const c = el('circle', {
      cx: xScale(p.x), cy: f.yScale(p.y), r: 4,
      fill: p.profit >= 0 ? PALETTE.green : PALETTE.red, opacity: 0.7, class: 'pt'
    }, f.svg);
    c.addEventListener('mousemove', (e) =>
      showTip(`<div class="tip-title">${p.inv ? p.inv + ' · ' : ''}${p.label}</div>
        <div class="tip-row">Cost<b>${money(p.x)}</b></div>
        <div class="tip-row">Sold<b>${money(p.y)}</b></div>
        <div class="tip-row">Profit<b style="color:${p.profit >= 0 ? PALETTE.green : PALETTE.red}">${money(p.profit)}</b></div>`, e));
    c.addEventListener('mouseleave', hideTip);
  }
  return f.svg;
}

/* --------------------------------------------------------------- sparkbar */

export function sparkline(container, values, color = PALETTE.brass) {
  if (!values.length) { container.innerHTML = ''; return; }
  container.innerHTML = '';
  const w = 100;
  const h = 26;
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, preserveAspectRatio: 'none' }, container);
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const y = (v) => h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1 || 1)) * w} ${y(v)}`).join(' ');
  el('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.75, 'stroke-linejoin': 'round' }, svg);
}
