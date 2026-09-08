/* Roost — popup controller. */

import { normalize, analyze, dataBounds, listVenues, shortId, UNASSIGNED, DAY } from './lib/analytics.js';
import { normalizeQuailSales, analyzeQuail } from './lib/quail.js';
import { reconcile } from './lib/reconcile.js';
import { planResolution, buildVenueContext, CONFIDENCE } from './lib/resolve.js';
import { buildLedger, rentForRange } from './lib/ledger.js';
import {
  lineChart, barChart, donut, hbar, scatter, empty, hideTip,
  money, pct, int, PALETTE, SERIES_COLORS, refreshPalette
} from './lib/charts.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  items: [],
  meta: null,
  mode: 'analyze',
  tab: 'overview',
  preset: 'all',
  start: null,
  end: null,
  stats: null,
  flowMode: 'money',
  // Each of these charts keeps its own $/units choice.
  dowMode: 'money',
  hourMode: 'units',
  venue: { kind: 'all', id: null },
  venueNames: {},
  venueInfo: { stores: {}, booths: {} },
  quail: null,
  quailSales: [],
  // Raw Sandpiper rows stay in `items` for Review; every figure elsewhere reads
  // `ledger`, which is those rows with register truth applied.
  ledger: [],
  ledgerSummary: null,
  badge: { count: 0, urgent: false },
  fixable: [],
  visibleFixable: [],
  findingsTotal: 0,
  findingsShown: 0,
  selected: new Set(),
  pendingConfirm: null,
  findingFilters: { severity: 'all', match: 'all', type: 'all' },
  applying: false,
  venueList: { stores: [], booths: [] },
  // Per-mode date ranges, so switching modes never rewrites another mode's window.
  ranges: {},
  itemSort: { key: 'acquired', dir: -1 }
};

/* Modes group views by the kind of question they answer: analysis is ranged and
 * aggregate, Daily is operational, Review is a task list, Records is lookup.
 * Each mode carries its own preset ranges — Daily wants days, Analyze wants
 * months — but never overrides a range the user set explicitly. */
const MODES = [
  {
    id: 'analyze',
    label: 'Analyze',
    presets: [['today', 'Today'], ['7d', '7D'], ['30d', '30D'], ['90d', '90D'], ['ytd', 'YTD'],
      ['12m', '1Y'], ['all', 'All time'], ['custom', 'Custom']],
    // Analysis reads best against the whole history; shorter windows are a
    // deliberate narrowing rather than the starting point.
    defaultPreset: 'all',
    tabs: [
      ['overview', 'Overview'], ['sales', 'Sales'], ['inventory', 'Inventory'],
      ['catalog', 'Catalog'], ['venues', 'Venues']
    ]
  },
  {
    id: 'review',
    label: 'Review',
    /* No range picker at all: reconciliation exists to prove the two systems
     * agree, and a window can only hide a disagreement that is still live. */
    presets: [],
    fullRange: true,
    defaultPreset: 'all',
    tabs: [['review', 'Review']]
  },
  {
    id: 'records',
    label: 'Records',
    presets: [['90d', '90D'], ['12m', '1Y'], ['all', 'All time'], ['custom', 'Custom']],
    tabs: [['items', 'Items'], ['pos', 'POS sales']]
  }
];

const modeById = (id) => MODES.find((m) => m.id === id) || MODES[0];
const defaultPresetFor = (id) => {
  const mode = modeById(id);
  return mode.defaultPreset || mode.presets[0][0];
};

/* --------------------------------------------------------------- helpers */

const endOfDay = (t) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); };
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const toInput = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fromInput = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const signClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const days = (n) => (n == null ? '—' : `${Math.round(n)}d`);
const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many || one + 's'}`;

function relativeTime(t) {
  const diff = Date.now() - t;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function banner(msg, kind = 'info') {
  const b = $('#banner');
  if (!msg) { b.classList.add('hidden'); return; }
  b.className = `banner ${kind}`;
  b.textContent = msg;
}

/* ----------------------------------------------------------------- range */

function applyPreset(preset) {
  state.preset = preset;
  const bounds = dataBounds(state.ledger.length ? state.ledger : state.items);
  const end = endOfDay(Math.max(Date.now(), bounds.max));
  const now = new Date();
  let start;
  switch (preset) {
    case '30d': start = startOfDay(Date.now() - 30 * DAY); break;
    case '90d': start = startOfDay(Date.now() - 90 * DAY); break;
    case '6m': { const d = new Date(); d.setMonth(d.getMonth() - 6); start = startOfDay(d.getTime()); break; }
    case '12m': { const d = new Date(); d.setFullYear(d.getFullYear() - 1); start = startOfDay(d.getTime()); break; }
    case 'ytd': start = new Date(now.getFullYear(), 0, 1).getTime(); break;
    case 'today': start = startOfDay(Date.now()); break;
    case '7d': start = startOfDay(Date.now() - 7 * DAY); break;
    case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); break;
    case 'custom': return; // inputs drive the range
    default: start = startOfDay(bounds.min);
  }
  state.start = start;
  // Ranges anchored to now shouldn't run past it, or "today" spans the whole dataset.
  state.end = preset === 'today' || preset === '7d' || preset === 'month'
    ? endOfDay(Date.now())
    : end;
  // Show the range actually in force: filling these from `end` left "Today"
  // displaying a window that ran to the last dated record in the data.
  $('#from').value = toInput(state.start);
  $('#to').value = toInput(state.end);
}

function renderModes() {
  // The anomaly count rides on the Review button so it is visible from any mode.
  const count = (state.badge && state.badge.count) || 0;
  const urgent = (state.badge && state.badge.urgent) || false;
  $('#modes').innerHTML = MODES
    .map((m) => {
      const badge = m.id === 'review' && count
        ? ` <span class="mode-badge${urgent ? ' urgent' : ''}" title="${count} anomal${count === 1 ? 'y' : 'ies'} in range">${count > 99 ? '99+' : count}</span>`
        : '';
      return `<button data-mode="${m.id}" class="${state.mode === m.id ? 'active' : ''}">${m.label}${badge}</button>`;
    })
    .join('');
  $$('#modes button').forEach((btn) => {
    btn.onclick = () => selectMode(btn.dataset.mode);
  });
}

function renderTabs() {
  const mode = modeById(state.mode);
  const strip = $('#tabs');
  strip.innerHTML = mode.tabs
    .map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? 'active' : ''}">${label}</button>`)
    .join('');
  // A single-tab mode has nothing to choose, so the strip only adds noise.
  strip.hidden = mode.tabs.length < 2;
  $$('#tabs button').forEach((btn) => {
    btn.onclick = () => selectTab(btn.dataset.tab);
  });
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === state.tab));
}

function selectTab(tabId) {
  state.tab = tabId;
  try {
    localStorage.setItem('sp_tab_' + state.mode, tabId);
  } catch (e) { /* nav state is a convenience only */ }
  renderTabs();
  hideTip();
  repaintCharts();
}

/** Stashes the range the mode being left was showing. */
function rememberRange() {
  if (!state.mode || state.start == null) return;
  if (modeById(state.mode).fullRange) return;   // nothing was chosen, so nothing to restore
  state.ranges[state.mode] = { preset: state.preset, start: state.start, end: state.end };
}

function selectMode(modeId) {
  const mode = modeById(modeId);
  rememberRange();
  state.mode = modeId;
  let remembered = null;
  try {
    remembered = localStorage.getItem('sp_tab_' + modeId);
    localStorage.setItem('sp_mode', modeId);
  } catch (e) { /* nav state is a convenience only */ }
  const valid = mode.tabs.some(([id]) => id === remembered);
  state.tab = valid ? remembered : mode.tabs[0][0];

  /* Each mode owns its range. Carrying one across meant Review inherited whatever
   * Analyze happened to be showing whenever both offered that preset, so a mode's
   * own default only ever applied by accident. */
  const saved = mode.fullRange ? null : state.ranges[modeId];
  if (mode.fullRange) {
    applyPreset('all');
  } else if (saved) {
    state.preset = saved.preset;
    state.start = saved.start;
    state.end = saved.end;
    $('#from').value = toInput(saved.start);
    $('#to').value = toInput(saved.end);
  } else {
    applyPreset(defaultPresetFor(modeId));
  }

  renderModes();
  renderPresets();
  renderTabs();
  render();
}

function repaintCharts() {
  if (!state.stats) return;
  renderCharts(state.stats);
  renderVenues(state.stats);
  renderPosCharts();
}

function renderRangeControls() {
  const full = !!modeById(state.mode).fullRange;
  $('#presets').hidden = full;
  document.querySelector('.custom-range').hidden = full;
  $('#range-note').hidden = !full;
}

function renderPresets() {
  renderRangeControls();
  $('#presets').innerHTML = modeById(state.mode).presets
    .map(([k, label]) => `<button class="chip ${state.preset === k ? 'active' : ''}" data-preset="${k}">${label}</button>`)
    .join('');
  $$('#presets .chip').forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.preset === 'custom') {
        state.preset = 'custom';
      } else {
        applyPreset(btn.dataset.preset);
      }
      renderPresets();
      render();
    };
  });
}

/* ------------------------------------------------------------------ KPIs */

/* ------------------------------------------------------------ KPI grammar */

/* The colour bar means one thing everywhere: how this number is doing.
 *   good  — healthy, nothing to do
 *   watch — worth an eye
 *   alert — needs attention
 *   (none) — a descriptive figure with no better or worse direction, e.g. a count
 * It previously mixed three encodings at once — category, sign and status — so a
 * red bar could mean "you are losing money" or just "this card is about costs".
 */
const STATUS_COLOR = { good: PALETTE.green, watch: PALETTE.brass, alert: PALETTE.red };

/** Higher is better. */
const bandUp = (v, good, watch) =>
  (v == null || !isFinite(v) ? null : v >= good ? 'good' : v >= watch ? 'watch' : 'alert');
/** Lower is better. */
const bandDown = (v, good, watch) =>
  (v == null || !isFinite(v) ? null : v <= good ? 'good' : v <= watch ? 'watch' : 'alert');
/** In the black or not. */
const bandSign = (v) => (v == null || !isFinite(v) ? null : v >= 0 ? 'good' : 'alert');

/** "▲ 23% vs prior 30 days", or nothing when there is no honest comparison. */
function trend(current, prior, { hasData = true } = {}) {
  if (!hasData || prior == null || prior === 0 || !isFinite(prior)) return '';
  const change = (current - prior) / Math.abs(prior);
  if (!isFinite(change) || Math.abs(change) < 0.005) return '<span class="trend flat">no change</span>';
  const up = change > 0;
  return `<span class="trend ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${pct(Math.abs(change), 0)}</span>`;
}

function kpi(label, value, sub, opts = {}) {
  const cls = opts.sign ? signClass(opts.signValue != null ? opts.signValue : 0) : '';
  // A compact label like "$4.8k" can hide up to $200, which is no use when two
  // cards are meant to be compared, so the exact figure is always one hover away.
  const exact = opts.exact != null ? ` title="${esc(opts.exact)}"` : '';
  const accent = opts.status ? STATUS_COLOR[opts.status] : opts.accent;
  return `<div class="kpi${opts.status ? ' is-' + opts.status : ''}" style="--accent:${accent || 'transparent'}">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value ${cls}"${exact}>${value}</div>
    <div class="kpi-sub">${sub || '&nbsp;'}</div>
  </div>`;
}


function renderKpis(s) {
  const rentInfo = state.rentInfo || { cents: 0, full: 0, partial: false };
  const q = state.quailStats;
  const prev = s.previous || { hasData: false };
  const grossProfit = s.sales.profit;
  const netProfit = grossProfit - rentInfo.cents;
  const rentCover = rentInfo.cents > 0 ? grossProfit / rentInfo.cents : null;
  const staleShare = s.inventory.units ? s.inventory.stale / s.inventory.units : 0;
  /* Only label the comparison when there is one; an empty prior window used to
   * leave a bare "vs prior period" hanging off a figure with nothing behind it. */
  const withTrend = (text, current, prior) => {
    const t = trend(current, prior, prev);
    return t ? `${text} ${t} vs prior` : text;
  };

  /* Standard consignment-retail vocabulary, used identically everywhere:
   * gross sales -> commission -> net payout -> cost of goods -> gross profit
   * -> booth rent -> net profit. Each card names the deduction it just made. */
  $('#kpis').innerHTML = [
    kpi('Gross sales', money(s.sales.gross, { compact: true }),
      withTrend(plural(s.counts.sold, 'sale'), s.sales.gross, prev.gross),
      { exact: money(s.sales.gross) }),
    kpi('Net payout', money(s.sales.net, { compact: true }),
      withTrend(`less ${money(s.sales.commissions, { compact: true })} commission`, s.sales.net, prev.net),
      { exact: money(s.sales.net) }),
    kpi('Gross profit', money(grossProfit, { compact: true }),
      `less ${money(s.sales.cogs, { compact: true })} cost of goods · ${pct(s.sales.margin)} margin`,
      { status: bandSign(grossProfit), exact: money(grossProfit) }),
    kpi('Net profit', money(netProfit, { compact: true }),
      rentInfo.partial
        ? `less rent ${money(rentInfo.cents, { compact: true })} of ${money(rentInfo.full, { compact: true })} so far`
        : `less ${money(rentInfo.cents, { compact: true })} booth rent`,
      { status: bandSign(netProfit), exact: money(netProfit) }),

    kpi('Stock at cost', money(s.inventory.cost, { compact: true }),
      plural(s.inventory.units, 'item') + ' unsold',
      { exact: money(s.inventory.cost) }),
    kpi('Asking value', money(s.inventory.ask, { compact: true }),
      `what that stock is priced at`,
      { exact: money(s.inventory.ask) }),
    kpi('Potential profit', money(s.inventory.potentialProfit, { compact: true }),
      'if it all sells at asking',
      { status: s.inventory.units ? bandSign(s.inventory.potentialProfit) : null,
        exact: money(s.inventory.potentialProfit) }),
    kpi('Spent on stock', money(s.buying.spend, { compact: true }),
      withTrend(plural(s.buying.units, 'item'), s.buying.spend, prev.spend),
      { exact: money(s.buying.spend) }),

    kpi('Rent covered', pct(rentCover, 0),
      rentInfo.partial ? 'gross profit against rent so far' : 'gross profit against booth rent',
      { status: bandUp(rentCover, 1, 0.6) }),
    kpi('Sell-through', pct(s.velocity.sellThrough),
      `${int(s.counts.sold)} of ${int(s.counts.sold + s.counts.onHand)} available`,
      { status: s.counts.sold + s.counts.onHand ? bandUp(s.velocity.sellThrough, 0.4, 0.2) : null }),
    kpi('Aged over 180 days', int(s.inventory.stale),
      s.inventory.stale ? `${money(s.inventory.staleCost, { compact: true })} tied up` : 'nothing sitting long',
      { status: s.inventory.units ? bandDown(staleShare, 0.001, 0.2) : null }),
    kpi('Since last sale', q && q.daysSinceLastSale != null ? days(q.daysSinceLastSale) : '—',
      q && q.lastSaleAt ? new Date(q.lastSaleAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'from the register',
      { status: q ? bandDown(q.daysSinceLastSale, 7, 21) : null })
  ].join('');

  const prevS = s.previous || { hasData: false };
  $('#kpis-sales').innerHTML = [
    kpi('Gross sales', money(s.sales.gross, { compact: true }),
      (() => { const t = trend(s.sales.gross, prevS.gross, prevS);
        return t ? `${plural(s.counts.sold, 'sale')} ${t} vs prior` : plural(s.counts.sold, 'sale'); })(),
      { exact: money(s.sales.gross) }),
    kpi('Commission', money(s.sales.commissions, { compact: true }),
      `${pct(s.inventory.commissionRate, 1)} of gross sales`,
      { exact: money(s.sales.commissions) }),
    kpi('Cost of goods', money(s.sales.cogs, { compact: true }),
      `avg ${money(s.counts.sold ? s.sales.cogs / s.counts.sold : 0, { compact: true })} per item`,
      { exact: money(s.sales.cogs) }),
    kpi('Gross profit', money(s.sales.profit, { compact: true }),
      (() => { const t = trend(s.sales.profit, prevS.profit, prevS);
        return `${money(s.sales.avgProfit, { compact: true })} per item${t ? ' ' + t + ' vs prior' : ''}`; })(),
      { status: bandSign(s.sales.profit), exact: money(s.sales.profit) }),

    kpi('Margin', pct(s.sales.margin),
      'gross profit as a share of sales',
      { status: s.counts.sold ? bandUp(s.sales.margin, 0.4, 0.2) : null }),
    kpi('Return on cost', pct(s.sales.roi),
      'gross profit per $1 of stock',
      { status: s.counts.sold ? bandUp(s.sales.roi, 1, 0.4) : null }),
    kpi('Avg sale price', money(s.sales.avgSale, { compact: true }),
      `best period ${s.sales.bestMonth ? s.sales.bestMonth.label : '—'}`,
      { exact: money(s.sales.avgSale) }),
    kpi('Avg discount', pct(s.sales.discountRate),
      `${pct(s.sales.fullPriceRate)} sold at full asking`,
      { status: s.counts.sold ? bandDown(s.sales.discountRate, 0.05, 0.15) : null })
  ].join('');

  const staleShareInv = s.inventory.units ? s.inventory.stale / s.inventory.units : 0;
  $('#kpis-inv').innerHTML = [
    kpi('Items unsold', int(s.inventory.units),
      `${plural(s.counts.unpriced, 'item')} without an asking price`,
      { status: s.counts.unpriced ? 'watch' : null }),
    kpi('Stock at cost', money(s.inventory.cost, { compact: true }),
      `avg ${money(s.inventory.units ? s.inventory.cost / s.inventory.units : 0, { compact: true })} per item`,
      { exact: money(s.inventory.cost) }),
    kpi('Asking value', money(s.inventory.ask, { compact: true }),
      `${money(s.inventory.potentialNet, { compact: true })} after commission`,
      { exact: money(s.inventory.ask) }),
    kpi('Potential profit', money(s.inventory.potentialProfit, { compact: true }),
      'if it all sells at asking',
      { status: s.inventory.units ? bandSign(s.inventory.potentialProfit) : null,
        exact: money(s.inventory.potentialProfit) }),

    kpi('Median age', days(s.inventory.medianAge),
      `avg ${days(s.inventory.avgAge)}`,
      { status: bandDown(s.inventory.medianAge, 90, 180) }),
    kpi('Aged over 180 days', int(s.inventory.stale),
      s.inventory.stale ? `${money(s.inventory.staleCost, { compact: true })} tied up` : 'nothing sitting long',
      { status: s.inventory.units ? bandDown(staleShareInv, 0.001, 0.2) : null }),
    kpi('Stock turns', `${s.velocity.turns.toFixed(2)}×`,
      'cost of goods ÷ stock at cost',
      { status: bandUp(s.velocity.turns, 1, 0.3) }),
    kpi('Days of supply', s.velocity.daysOfSupply ? days(s.velocity.daysOfSupply) : '—',
      'at the current sales pace',
      { status: bandDown(s.velocity.daysOfSupply, 120, 365) })
  ].join('');
}

/* --------------------------------------------------------------- tables */

function table(rows, columns, emptyMsg = 'Nothing here yet') {
  if (!rows.length) return `<div class="empty-row">${emptyMsg}</div>`;
  return `<table><thead><tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.title}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? 'num ' : ''}${c.cls ? c.cls(r) : ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const nameCell = (r) => `<span class="inv">${esc(r.inv || '—')}</span>${esc(r.desc)}`;

function renderTables(s) {
  const profitCols = [
    { title: 'Item', render: nameCell, cls: () => 'name' },
    { title: 'Cost', num: true, render: (r) => money(r.cost, { compact: true }) },
    { title: 'Sold', num: true, render: (r) => money(r.soldPrice, { compact: true }) },
    { title: 'Profit', num: true, render: (r) => money(r.profit, { compact: true }), cls: (r) => signClass(r.profit) },
    { title: 'Days', num: true, render: (r) => days(r.daysToSell) }
  ];
  $('#t-top').innerHTML = table(s.lists.topProfit, profitCols, 'No sales in this range');
  $('#t-loss').innerHTML = table(s.lists.worstProfit, profitCols, 'No losses in this range — nice.');

  $('#t-slow').innerHTML = table(s.lists.slowMovers, [
    { title: 'Item', render: nameCell, cls: () => 'name' },
    { title: 'Age', num: true, render: (r) => days(r.age), cls: (r) => (r.age > 180 ? 'neg' : '') },
    { title: 'Cost', num: true, render: (r) => money(r.cost, { compact: true }) },
    { title: 'Ask', num: true, render: (r) => (r.ask ? money(r.ask, { compact: true }) : '<span class="pill">unpriced</span>') }
  ], 'No unsold inventory');

  $('#t-bets').innerHTML = table(s.lists.biggestBets, [
    { title: 'Item', render: nameCell, cls: () => 'name' },
    { title: 'Cost', num: true, render: (r) => money(r.cost, { compact: true }) },
    { title: 'Ask', num: true, render: (r) => money(r.ask, { compact: true }) },
    { title: 'Markup', num: true, render: (r) => (r.markup ? `${r.markup.toFixed(1)}×` : '—') }
  ], 'No unsold inventory');

  $('#t-cats').innerHTML = table(s.categories, [
    { title: 'Category', render: (r) => esc(r.name), cls: () => 'name' },
    { title: 'On hand', num: true, render: (r) => int(r.onHand) },
    { title: 'Sold', num: true, render: (r) => int(r.sold) },
    { title: 'Sell-through', num: true, render: (r) => pct(r.sellThrough, 0) },
    { title: 'Stock at cost', num: true, render: (r) => money(r.cost, { compact: true }) },
    { title: 'Asking value', num: true, render: (r) => money(r.ask, { compact: true }) },
    { title: 'Net payout', num: true, render: (r) => money(r.net, { compact: true }) },
    { title: 'Profit', num: true, render: (r) => money(r.profit, { compact: true }), cls: (r) => signClass(r.profit) }
  ], 'No categories');
}

/* --------------------------------------------------------------- health */

function renderHealth(s) {
  const rows = [];
  const add = (tone, text, val) => rows.push({ tone, text, val });
  const color = { good: PALETTE.green, warn: PALETTE.brass, bad: PALETTE.red };

  add(s.counts.unpriced ? 'warn' : 'good',
    `<b>${int(s.counts.unpriced)}</b> unsold items have no asking price`,
    s.counts.unpriced ? 'Needs pricing' : 'All priced');
  add(s.counts.zeroCost ? 'warn' : 'good',
    `<b>${int(s.counts.zeroCost)}</b> unsold items are recorded at $0 cost`,
    s.counts.zeroCost ? 'Check costs' : 'Costs set');
  add(s.inventory.stale > s.inventory.units * 0.3 ? 'bad' : s.inventory.stale ? 'warn' : 'good',
    `<b>${int(s.inventory.stale)}</b> items have been held over 180 days`,
    money(s.inventory.staleCost, { compact: true }));
  add(s.sales.discountRate > 0.1 ? 'warn' : 'good',
    `Items sell for <b>${pct(s.sales.discountRate)}</b> below asking price on average`,
    pct(s.sales.fullPriceRate) + ' at full');
  add(s.sales.profit >= 0 ? 'good' : 'bad',
    `Every $1 of cost returned <b>${s.sales.roi != null ? (1 + s.sales.roi).toFixed(2) : '—'}</b> in this range`,
    pct(s.sales.roi));

  // Register-only sales carry no cost basis, so profit is optimistic by whatever
  // that stock actually cost. Worth saying rather than quietly flattering the number.
  const led = state.ledgerSummary;
  if (led) {
    add(led.costUnknown ? 'warn' : 'good',
      led.costUnknown
        ? `<b>${int(led.costUnknown)}</b> sale(s) rang up with no Sandpiper record, so profit ignores their cost`
        : 'Every sale counted has a cost basis behind it',
      led.costUnknown ? 'profit is optimistic' : 'costs complete');
    add(led.corrected ? 'warn' : 'good',
      led.corrected
        ? `<b>${int(led.corrected)}</b> sale(s) use register values where Sandpiper disagreed`
        : 'Sandpiper matches the register on every sale',
      led.corrected ? 'see Anomalies' : 'in step');
  }

  $('#health').innerHTML = rows.map((r) => `
    <div class="health-row">
      <span class="health-icon" style="background:${color[r.tone]}"></span>
      <span class="health-text">${r.text}</span>
      <span class="health-val" style="color:${color[r.tone]}">${r.val}</span>
    </div>`).join('');
}

/** One reconciled set of sales for every figure outside the Review tab. */
function rebuildLedger() {
  const built = buildLedger(state.items, state.quailSales, buildVenueContext(state.venueInfo));
  state.ledger = built.items;
  state.ledgerSummary = built.summary;

  /* The badge counts what Review will actually show, which is always everything.
   * Deriving it from the current range made it read 1 while Analyze was narrowed
   * to today and 7 the moment you clicked through. Range-independent, so this is
   * computed once per sync rather than on every render. */
  const bounds = dataBounds(state.ledger.length ? state.ledger : state.items);
  const full = state.quailSales.length
    ? reconcile(state.items, state.quailSales, { start: bounds.min, end: Math.max(Date.now(), bounds.max) })
    : { findings: [] };
  state.badge = {
    count: full.findings.length,
    urgent: full.findings.some((f) => f.severity === 'high')
  };
}

/* ---------------------------------------------------------------- venues */

/** Falls back to a stable short id when the user hasn't named a venue. */
function venueInfo(id, kind) {
  const bucket = kind === 'store' ? state.venueInfo.stores : state.venueInfo.booths;
  return (bucket && bucket[id]) || null;
}

/** Your own name wins, then the name Sandpiper returns, then a short id. */
function venueLabel(id, kind) {
  if (id === UNASSIGNED || !id) return kind === 'store' ? 'No store recorded' : 'No booth recorded';
  const info = venueInfo(id, kind);
  return state.venueNames[id] || (info && info.name) || `${kind === 'store' ? 'Store' : 'Booth'} ${shortId(id)}`;
}

function venueLocation(id) {
  const info = venueInfo(id, 'store');
  if (!info) return '—';
  return [info.city, info.state].filter(Boolean).join(', ') || '—';
}

/** The booth's own storeId is authoritative; sales data is the fallback. */
function boothStore(row) {
  const info = venueInfo(row.id, 'booth');
  return (info && info.storeId) || row.store;
}

async function saveVenueName(id, name) {
  const trimmed = name.trim();
  if (trimmed) state.venueNames[id] = trimmed;
  else delete state.venueNames[id];
  await chrome.storage.local.set({ sp_venue_names: state.venueNames });
  renderVenueSelector();
}

function renderVenueSelector() {
  const sel = $('#venue');
  const { stores, booths } = state.venueList;
  const opts = ['<option value="all">All venues</option>'];
  if (stores.length) {
    opts.push('<optgroup label="Stores">');
    for (const v of stores) opts.push(`<option value="store:${v.id}">${esc(venueLabel(v.id, 'store'))}</option>`);
    opts.push('</optgroup>');
  }
  if (booths.length) {
    opts.push('<optgroup label="Booths">');
    for (const v of booths) opts.push(`<option value="booth:${v.id}">${esc(venueLabel(v.id, 'booth'))}</option>`);
    opts.push('</optgroup>');
  }
  sel.innerHTML = opts.join('');
  sel.value = state.venue.kind === 'all' ? 'all' : `${state.venue.kind}:${state.venue.id}`;
  // Only worth showing when there is actually something to choose between.
  sel.style.display = stores.length > 1 || booths.length > 1 ? '' : 'none';
}

function venueRows(rows, kind) {
  const cols = [
    {
      title: kind === 'store' ? 'Store' : 'Booth',
      render: (r) => `<input class="name-input" data-venue="${r.id}" value="${esc(venueLabel(r.id, kind))}"${r.id === UNASSIGNED ? ' disabled' : ''}>`
    },
    { title: 'Sold', num: true, render: (r) => int(r.units) },
    { title: 'Gross sales', num: true, render: (r) => money(r.gross, { compact: true }) },
    { title: 'Commission', num: true, render: (r) => money(-r.commissions, { compact: true }) },
    { title: 'Net payout', num: true, render: (r) => money(r.net, { compact: true }) },
    { title: 'Profit', num: true, render: (r) => money(r.profit, { compact: true }), cls: (r) => signClass(r.profit) },
    { title: 'Margin', num: true, render: (r) => pct(r.margin, 0) },
    { title: 'Avg sale', num: true, render: (r) => money(r.avgSale, { compact: true }) },
    { title: 'Median days', num: true, render: (r) => days(r.medianDays) },
    { title: 'Share', num: true, render: (r) => pct(r.share, 0) }
  ];
  if (kind === 'store') {
    cols.splice(1, 0, { title: 'Location', render: (r) => esc(venueLocation(r.id)) });
  } else {
    cols.splice(1, 0, { title: 'Store', render: (r) => esc(venueLabel(boothStore(r), 'store')), cls: () => 'name' });
    // Contracted rate vs. what was actually deducted — a mismatch is worth seeing.
    cols.splice(5, 0, {
      title: 'Rate (agreed)',
      num: true,
      render: (r) => {
        const info = venueInfo(r.id, 'booth');
        const agreed = info && info.consignmentRate != null ? info.consignmentRate : null;
        const actual = r.commissionRate;
        const off = agreed != null && actual != null && Math.abs(agreed - actual) > 0.005;
        return `${pct(actual, 1)}${agreed != null ? ` <span class="${off ? 'neg' : 'muted-inline'}">(${pct(agreed, 1)})</span>` : ''}`;
      }
    });
  }
  return table(rows, cols, 'No sales with a venue in this range');
}

function renderVenues(s) {
  const { stores, booths } = s.venues;

  hbar($('#c-booth-rev'), {
    rows: booths.map((b) => ({
      label: venueLabel(b.id, 'booth'),
      value: b.net,
      sub: `${b.units} sold · ${money(b.profit)} gross profit`
    })),
    format: (v) => money(v, { compact: true }),
    colorFor: (r, i) => (r.value < 0 ? PALETTE.red : SERIES_COLORS[i % SERIES_COLORS.length])
  });

  donut($('#c-store-share'), {
    height: 158,
    centerValue: money(stores.reduce((a, v) => a + v.net, 0), { compact: true }),
    centerLabel: 'net payout',
    segments: stores.map((v) => ({ label: venueLabel(v.id, 'store'), value: Math.max(0, v.net) })),
    format: (v) => money(v, { compact: true })
  });

  const series = s.venues.boothSeries.map((b, i) => ({
    name: venueLabel(b.id, 'booth'),
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    values: b.values
  }));
  barChart($('#c-booth-time'), {
    labels: s.buckets.map((b) => b.label),
    series,
    height: 176,
    stacked: series.length > 1
  });
  legend($('#l-booth-time'), series);

  $('#t-stores').innerHTML = venueRows(stores, 'store');
  $('#t-booths').innerHTML = venueRows(booths, 'booth');

  $$('.name-input').forEach((input) => {
    const commit = () => saveVenueName(input.dataset.venue, input.value);
    input.onblur = commit;
    input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
  });
}

/* ------------------------------------------------------- daily (Quail POS) */

/** Quail's booth id for the selected venue, or null when nothing is scoped. */
function scopedBoothExternalId() {
  if (state.venue.kind !== 'booth' || !state.venue.id) return null;
  const info = state.venueInfo.booths && state.venueInfo.booths[state.venue.id];
  return info && info.externalId != null ? info.externalId : null;
}

/** Rent for the window, narrowed to the selected booth so it matches the sales beside it. */
function currentRent() {
  const rows = (state.quail && state.quail.rent) || [];
  const boothId = scopedBoothExternalId();
  const scoped = boothId == null ? rows : rows.filter((r) => r.boothId === boothId);
  return rentForRange(scoped, state.start, state.end);
}

/** POS rows for the selected venue, so Daily's charts match the rest of the app. */
function scopedQuailSales() {
  const boothId = scopedBoothExternalId();
  if (boothId == null) return state.quailSales;
  return state.quailSales.filter((s) => s.boothId === boothId);
}

/**
 * The register-side charts. Money figures live in the KPI ladder above, which
 * reads the shared ledger; these need Quail's clock times, which only the POS has.
 */
function renderPosCharts() {
  const note = $('#quail-note');
  if (!state.quailSales.length) {
    if (note) {
      note.hidden = false;
      note.innerHTML = state.meta && state.meta.quailError
        ? `No point-of-sale data: ${esc(state.meta.quailError)}`
        : 'No point-of-sale data yet. Sign in at vendor.quailhq.com, then fetch again.';
    }
    ['#c-daily', '#c-dow', '#c-hour', '#c-methods'].forEach((sel) => empty($(sel), 'No POS data'));
    $('#t-recent').innerHTML = '';
    return;
  }
  if (note) note.hidden = true;
  const q = state.quailStats;
  if (!q) return;

  const dailySeries = [{ name: 'Gross sales', color: PALETTE.blue, values: q.days.map((d) => d.gross) }];
  barChart($('#c-daily'), {
    labels: q.days.map((d) => d.label),
    series: dailySeries,
    height: 180,
    tipFormat: (v, ser, i) => `${money(v)} · ${int(q.days[i].units)} items`
  });
  legend($('#l-daily'), dailySeries);

  renderDowChart(q);
  renderHourChart(q);

  donut($('#c-methods'), {
    height: 158,
    centerValue: money(q.gross, { compact: true }),
    centerLabel: 'gross sales',
    segments: q.methods.map((m) => ({ label: m.method, value: m.gross })),
    format: (v) => money(v, { compact: true })
  });

  $('#t-recent').innerHTML = table(q.recent, [
    { title: 'When', render: (r) => new Date(r.soldAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) },
    { title: 'Item', render: (r) => `<span class="inv">${esc(r.inv || '—')}</span>${esc(r.desc)}`, cls: () => 'name' },
    { title: 'Price', num: true, render: (r) => money(r.price, { compact: true }) },
    { title: 'Net payout', num: true, render: (r) => money(r.net, { compact: true }) },
    { title: 'Paid', render: (r) => esc(r.method) }
  ], 'No register sales in this range');
}

/** Searchable transaction-level view of the register records. */
function renderPosLedger() {
  const note = $('#quail-note-3');
  if (note) note.hidden = state.quailSales.length > 0;
  if (!state.quailSales.length) {
    if (note) {
      note.innerHTML = state.meta && state.meta.quailError
        ? `No point-of-sale data: ${esc(state.meta.quailError)}`
        : 'No point-of-sale data yet. Sign in at vendor.quailhq.com, then fetch again.';
    }
    $('#t-pos').innerHTML = '';
    return;
  }

  const methodSelect = $('#pos-method');
  const methods = [...new Set(state.quailSales.map((s) => s.method))].sort();
  if (methodSelect.options.length !== methods.length + 1) {
    methodSelect.innerHTML = '<option value="all">All payments</option>'
      + methods.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  }

  const q = $('#pos-search').value.trim().toLowerCase();
  const method = methodSelect.value;
  let rows = scopedQuailSales().filter((s) => s.soldAt >= state.start && s.soldAt <= state.end);
  if (method !== 'all') rows = rows.filter((s) => s.method === method);
  if (q) rows = rows.filter((s) => s.desc.toLowerCase().includes(q) || String(s.inv).toLowerCase().includes(q));
  rows.sort((a, b) => b.soldAt - a.soldAt);

  const shown = rows.slice(0, 500);
  $('#t-pos').innerHTML = table(shown, [
    { title: 'When', render: (r) => new Date(r.soldAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) },
    { title: '#', render: (r) => esc(r.inv || '—') },
    { title: 'Item', render: (r) => esc(r.desc), cls: () => 'name' },
    { title: 'Price', num: true, render: (r) => money(r.price, { compact: true }) },
    { title: 'Tax', num: true, render: (r) => money(r.tax, { compact: true }) },
    { title: 'Commission', num: true, render: (r) => money(-r.consignment, { compact: true }) },
    { title: 'Net payout', num: true, render: (r) => money(r.net, { compact: true }) },
    { title: 'Paid', render: (r) => esc(r.method) },
    { title: 'Txn', num: true, render: (r) => (r.transactionId == null ? '—' : String(r.transactionId)) }
  ], 'No register sales in this range')
    + (rows.length > shown.length ? `<div class="empty-row">Showing first ${shown.length} of ${rows.length}</div>` : '');
}

/** Weekday performance, averaged per occurrence so a partial range can't skew it. */
function renderDowChart(q) {
  const asMoney = state.dowMode === 'money';
  barChart($('#c-dow'), {
    labels: q.dayOfWeek.map((d) => d.label),
    series: [{
      name: asMoney ? 'Avg takings' : 'Avg items',
      color: PALETTE.brass,
      values: q.dayOfWeek.map((d) => (asMoney ? d.avgGross : d.avgUnits))
    }],
    height: 170,
    // Averages per weekday are usually fractional, so integer ticks would lie.
    yFormat: asMoney ? (v) => money(v, { compact: true }) : (v) => (v >= 10 ? int(v) : v.toFixed(1)),
    tipFormat: (v, ser, i) => {
      const d = q.dayOfWeek[i];
      const each = `over ${d.occurrences} × ${d.label}`;   // "4 Thus" read badly
      return asMoney
        ? `${money(d.avgGross)} avg · ${d.avgUnits.toFixed(1)} items avg ${each}`
        : `${d.avgUnits.toFixed(1)} items avg · ${money(d.avgGross)} avg ${each}`;
    }
  });
}

/** Hour of day, clipped to the hours that actually saw trade. */
function renderHourChart(q) {
  const asMoney = state.hourMode === 'money';
  const active = q.hours.filter((h) => h.units > 0);
  const lo = active.length ? Math.max(0, active[0].hour - 1) : 8;
  const hi = active.length ? Math.min(23, active[active.length - 1].hour + 1) : 20;
  const window = q.hours.slice(lo, hi + 1);
  barChart($('#c-hour'), {
    labels: window.map((h) => h.label),
    series: [{
      name: asMoney ? 'Gross sales' : 'Items',
      color: PALETTE.purple,
      values: window.map((h) => (asMoney ? h.gross : h.units))
    }],
    height: 170,
    integerY: !asMoney,
    yFormat: asMoney ? (v) => money(v, { compact: true }) : (v) => int(v),
    tipFormat: (v, ser, i) => (asMoney
      ? `${money(window[i].gross)} · ${int(window[i].units)} items`
      : `${int(window[i].units)} items · ${money(window[i].gross)}`)
  });
}

/* ----------------------------------------------------------- reconciliation */

const FINDING_LABELS = {
  'quail-sale-missing-in-sandpiper': 'Sold in Quail, unknown to Sandpiper',
  'sold-in-quail-not-in-sandpiper': 'Sold in Quail, still unsold in Sandpiper',
  'sandpiper-sale-missing-in-quail': 'Sold in Sandpiper, no Quail record',
  'probable-untagged-match': 'Untagged POS sale, probable match',
  'quail-sale-untagged': 'POS sale with no inventory tag',
  'price-mismatch': 'Sale price disagrees',
  'commission-mismatch': 'Commission disagrees',
  'late-entry': 'Recorded late',
  'duplicate-inventory-number': 'Duplicate inventory number'
};

/* --------------------------------------------------------- resolve flows */

const findingKey = (f, i) => `${f.type}|${(f.item && f.item.id) || (f.quail && f.quail.id) || i}`;

/** How much to trust an automatic fix for this row: drives the chip and bulk actions. */
const matchOf = (entry) => (entry.plan ? entry.plan.confidence : 'manual');

const MATCH_HINT = {
  exact: 'Matched on inventory number in both systems, so the correction is certain.',
  probable: 'Inferred from a matching price and time. Worth a look before applying.',
  manual: 'No automatic fix — this one needs a person.'
};

function visibleFindings(entries) {
  const f = state.findingFilters;
  return entries.filter((e) => (f.severity === 'all' || e.finding.severity === f.severity)
    && (f.match === 'all' || matchOf(e) === f.match)
    && (f.type === 'all' || e.finding.type === f.type));
}

/** Renders the diff a plan would write, so nothing is applied unseen. */
function planPreview(entry) {
  return entry.plan.changes
    .map((c) => `<span class="confirm-change">${esc(c.label)} <b>${esc(c.displayFrom == null ? '—' : String(c.displayFrom))}</b> → <b>${esc(c.display)}</b></span>`)
    .join(' · ');
}

/** Only offers kinds that actually occur, so the list can't suggest empty filters. */
function renderTypeFilter(entries) {
  const sel = $('#f-type');
  const present = [...new Set(entries.map((e) => e.finding.type))]
    .sort((a, b) => (FINDING_LABELS[a] || a).localeCompare(FINDING_LABELS[b] || b));
  const wanted = ['all', ...present].join('|');
  if (sel.dataset.built === wanted) return;
  sel.dataset.built = wanted;
  sel.innerHTML = '<option value="all">All kinds</option>'
    + present.map((t) => `<option value="${esc(t)}">${esc(FINDING_LABELS[t] || t)}</option>`).join('');
  if (![...sel.options].some((o) => o.value === state.findingFilters.type)) {
    state.findingFilters.type = 'all';
  }
  sel.value = state.findingFilters.type;
}

function renderFixBar() {
  const bar = $('#fix-bar');
  if (!state.findingsTotal) { bar.hidden = true; return; }
  bar.hidden = false;

  if (state.pendingConfirm) {
    const { entries, label } = state.pendingConfirm;
    const probable = entries.filter((e) => e.plan.confidence === CONFIDENCE.probable).length;
    bar.className = 'fix-bar confirm';
    bar.innerHTML = `
      <div class="confirm-head">${label}: ${entries.length} item${entries.length === 1 ? '' : 's'} will be updated in Sandpiper</div>
      <div class="confirm-list">
        ${entries.map((e) => `<div class="confirm-row">
            <span class="inv">${esc(e.plan.inv || '—')}</span>
            <span>${planPreview(e)}</span>
          </div>`).join('')}
      </div>
      <div class="confirm-actions">
        ${probable ? `<span class="confirm-warn">${probable} of these rest on a probable match, not an exact one.</span>` : '<span class="confirm-warn"></span>'}
        <button class="fix-btn" id="fix-cancel">Cancel</button>
        <button class="fix-btn primary" id="fix-apply">${state.applying ? 'Applying…' : `Apply ${entries.length} edit${entries.length === 1 ? '' : 's'}`}</button>
      </div>`;
    $('#fix-cancel').onclick = () => { state.pendingConfirm = null; renderFixBar(); };
    $('#fix-apply').onclick = () => applyPlans(entries);
    if (state.applying) $('#fix-apply').disabled = true;
    return;
  }

  /* Bulk actions act on what the filters leave on screen, so narrowing to a
   * severity or a kind and hitting "resolve" does what it looks like it does.
   * Select-all in the header plus this button covers what a separate
   * "resolve all exact" used to do, and the match filter makes that selection
   * explicit rather than implied by a button label. */
  const shown = state.visibleFixable;
  const chosen = shown.filter((e) => state.selected.has(e.key));
  const filtered = state.findingsShown < state.findingsTotal;
  bar.className = 'fix-bar';
  bar.innerHTML = `
    <span class="count"><b>${shown.length}</b> fixable${filtered ? ' in view' : ''} · <b>${chosen.length}</b> selected</span>
    <button class="fix-btn link" id="fix-clear"${chosen.length ? '' : ' disabled'}>Clear</button>
    <button class="fix-btn primary" id="fix-selected"${chosen.length ? '' : ' disabled'}>Resolve selected${chosen.length ? ` (${chosen.length})` : ''}</button>`;
  $('#fix-clear').onclick = () => { state.selected.clear(); renderReconcile(); };
  $('#fix-selected').onclick = () => confirmPlans(chosen, 'Resolve selected');
}

/**
 * Bulk actions confirm first, because you cannot see every change they would
 * make. A single row's Fix does not: the exact change is already printed under
 * the finding, so a second click on a panel elsewhere in the card is friction
 * that makes the button look broken.
 */
function confirmPlans(entries, label) {
  if (!entries.length) return;
  state.pendingConfirm = { entries, label };
  renderFixBar();
  $('#fix-bar').scrollIntoView({ block: 'nearest' });
}

async function applyPlans(entries) {
  state.applying = true;
  renderFixBar();
  try {
    const res = await send('applyEdits', {
      plans: entries.map((e) => ({
        itemId: e.plan.itemId,
        changes: e.plan.changes.map((c) => ({ field: c.field, to: c.to }))
      }))
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'The edit request failed.');

    const failed = res.results.filter((r) => !r.ok);
    if (res.items) {
      state.items = normalize(res.items);
      state.venueList = listVenues(state.items);
      rebuildLedger();
    }
    state.selected.clear();
    state.pendingConfirm = null;
    // Name what changed for a single fix; a bulk run just reports the count.
    const single = entries.length === 1 ? entries[0].plan : null;
    banner(
      failed.length
        ? `Updated ${int(res.applied)} of ${int(entries.length)}. ${failed.length} failed: ${failed[0].error}`
        : single
          ? `Updated #${single.inv}: ${single.summary}`
          : `Updated ${int(res.applied)} item${res.applied === 1 ? '' : 's'} in Sandpiper.`,
      failed.length ? 'error' : 'ok'
    );
    if (!failed.length) setTimeout(() => banner(''), 3200);
    render();
  } catch (e) {
    banner(e.message, 'error');
  } finally {
    state.applying = false;
    renderFixBar();
  }
}

function renderReconcile() {
  if (!state.quailSales.length) {
    $('#kpis-recon').innerHTML = '';
    empty($('#c-findings'), 'No POS data to compare');
    $('#t-findings').innerHTML = '<div class="empty-row">Sign in at vendor.quailhq.com and fetch again.</div>';
    state.fixable = [];
    state.visibleFixable = [];
    state.findingsTotal = 0;
    state.findingsShown = 0;
    $('#fix-bar').hidden = true;
    renderModes();               // otherwise the badge keeps a stale count
    return;
  }
  const r = reconcile(state.items, state.quailSales, { start: state.start, end: state.end });
  state.recon = r;

  // Pair every finding with the edit that would settle it, if one exists.
  const ctx = buildVenueContext(state.venueInfo);
  const entries = r.findings.map((f, i) => ({ key: findingKey(f, i), finding: f, plan: planResolution(f, ctx) }));
  const byKey = new Map(entries.map((e) => [e.key, e]));
  state.findingsTotal = entries.length;
  state.fixable = entries.filter((e) => e.plan);

  renderTypeFilter(entries);
  const visible = visibleFindings(entries);
  state.findingsShown = visible.length;
  state.visibleFixable = visible.filter((e) => e.plan);

  /* Selections are dropped when a row leaves the view, so a bulk action can never
   * reach something the filters are hiding. */
  const visibleKeys = new Set(visible.map((e) => e.key));
  for (const key of [...state.selected]) if (!visibleKeys.has(key)) state.selected.delete(key);
  renderModes();

  const high = r.findings.filter((f) => f.severity === 'high').length;
  $('#kpis-recon').innerHTML = [
    kpi('Sales matched', pct(r.totals.matchRate, 0),
      `${int(r.totals.matched)} of ${int(r.totals.quailSales)} register sales`,
      { status: bandUp(r.totals.matchRate, 1, 0.9) }),
    kpi('Needs attention', int(high), high ? 'high-severity findings' : 'nothing serious',
      { status: high ? 'alert' : 'good' }),
    kpi('Sales difference', money(r.totals.grossDelta, { compact: true }),
      'Sandpiper minus the register',
      { status: bandDown(Math.abs(r.totals.grossDelta), 0, 500), exact: money(r.totals.grossDelta) }),
    kpi('Total findings', int(r.findings.length),
      `${int(r.totals.sandpiperSales)} Sandpiper / ${int(r.totals.quailSales)} register sales`,
      { status: r.findings.length ? 'watch' : 'good' })
  ].join('');

  hbar($('#c-findings'), {
    rows: Object.entries(r.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ label: FINDING_LABELS[type] || type, value: count })),
    format: (v) => int(v),
    colorFor: (row) => (/disagree|unknown|unsold/i.test(row.label) ? PALETTE.red : PALETTE.brass)
  });

  const pickable = state.visibleFixable;
  const allPicked = pickable.length > 0 && pickable.every((e) => state.selected.has(e.key));

  $('#t-findings').innerHTML = table(visible, [
    {
      title: `<input type="checkbox" id="pick-all"${allPicked ? ' checked' : ''}`
        + `${pickable.length ? '' : ' disabled'} title="Select every fixable row in view">`,
      cls: () => 'pick',
      render: (e) => (e.plan
        ? `<input type="checkbox" data-key="${esc(e.key)}"${state.selected.has(e.key) ? ' checked' : ''}>`
        : '')
    },
    {
      title: 'Match',
      render: (e) => {
        const m = matchOf(e);
        return `<span class="pill ${m}" title="${esc(MATCH_HINT[m])}">${m}</span>`;
      }
    },
    { title: 'Severity', render: (e) => `<span class="pill ${e.finding.severity}">${e.finding.severity}</span>` },
    { title: 'What', render: (e) => esc(FINDING_LABELS[e.finding.type] || e.finding.type) },
    { title: 'When', render: (e) => (e.finding.soldAt ? new Date(e.finding.soldAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—') },
    {
      title: 'Detail',
      cls: () => 'wrap',
      render: (e) => `<div class="finding-detail">${esc(e.finding.detail)}</div>`
        + (e.plan ? `<div class="finding-note">Fix: ${esc(e.plan.summary)}</div>`
                  : (e.finding.note ? `<div class="finding-note">${esc(e.finding.note)}</div>` : ''))
    },
    {
      title: '',
      cls: () => 'act',
      render: (e) => (e.plan ? `<button class="fix-btn" data-fix="${esc(e.key)}">Fix</button>` : '')
    }
  ], state.findingsTotal
    ? 'No anomalies match these filters.'
    : 'No anomalies in this range — the two systems agree.');

  const pickAll = $('#pick-all');
  if (pickAll) {
    const some = pickable.some((e) => state.selected.has(e.key));
    pickAll.indeterminate = some && !allPicked;
    pickAll.onchange = () => {
      for (const e of pickable) {
        if (pickAll.checked) state.selected.add(e.key);
        else state.selected.delete(e.key);
      }
      renderReconcile();
    };
  }

  $$('#t-findings tbody input[type="checkbox"]').forEach((box) => {
    box.onchange = () => {
      if (box.checked) state.selected.add(box.dataset.key);
      else state.selected.delete(box.dataset.key);
      renderFixBar();
    };
  });
  $$('#t-findings button[data-fix]').forEach((btn) => {
    btn.onclick = () => {
      const entry = byKey.get(btn.dataset.fix);
      if (!entry || !entry.plan || state.applying) return;
      btn.disabled = true;
      btn.textContent = '…';
      // One row, one deliberate click, change already shown: apply it directly.
      applyPlans([entry]);
    };
  });
  renderFixBar();
}

/* --------------------------------------------------------------- charts */

function legend(el, series) {
  el.innerHTML = series.map((s) => `<span><i class="dot" style="background:${s.color}"></i>${s.name}</span>`).join('');
}

/**
 * Buying vs. selling. In money mode this is cash flow — what you spent on new
 * stock against what the sales actually paid out — which is a different question
 * from "Revenue vs. cost of goods" (the cost of the items that sold).
 * Either mode shows both the dollars and the unit count on hover.
 */
function renderFlowChart(s) {
  const labels = s.buckets.map((b) => b.label);
  const asMoney = state.flowMode === 'money';
  const acquiredUnits = s.buckets.map((b) => b.acquired);
  const soldUnits = s.buckets.map((b) => b.units);

  const series = asMoney
    ? [
      { name: 'Spent on stock', color: PALETTE.purple, values: s.buckets.map((b) => b.spend), alt: acquiredUnits.map((n) => `${int(n)} items`) },
      { name: 'Net payout', color: PALETTE.green, values: s.buckets.map((b) => b.net), alt: soldUnits.map((n) => `${int(n)} items`) }
    ]
    : [
      { name: 'Acquired', color: PALETTE.purple, values: acquiredUnits, alt: s.buckets.map((b) => money(b.spend, { compact: true })) },
      { name: 'Sold', color: PALETTE.green, values: soldUnits, alt: s.buckets.map((b) => money(b.net, { compact: true })) }
    ];

  barChart($('#c-flow'), {
    labels, series, height: 168,
    integerY: !asMoney,
    yFormat: asMoney ? (v) => money(v, { compact: true }) : (v) => int(v),
    tipFormat: (v, ser, i) => `${asMoney ? money(v) : `${int(v)} items`}${ser.alt ? ` · ${ser.alt[i]}` : ''}`
  });
  legend($('#l-flow'), series);
}

function renderCharts(s) {
  refreshPalette();
  const labels = s.buckets.map((b) => b.label);

  // Overview — cumulative
  const cumSeries = [
    { name: 'Cumulative gross profit', color: PALETTE.green, values: s.cumulative.map((b) => b.profit) },
    { name: 'Cumulative net payout', color: PALETTE.blue, values: s.cumulative.map((b) => b.net) }
  ];
  lineChart($('#c-cumulative'), { labels, series: cumSeries, height: 180 });
  legend($('#l-cumulative'), cumSeries);

  // Overview — revenue vs cogs
  const revSeries = [
    { name: 'Net payout', color: PALETTE.blue, values: s.buckets.map((b) => b.net) },
    { name: 'Cost of goods', color: PALETTE.purple, values: s.buckets.map((b) => b.cogs) }
  ];
  barChart($('#c-revenue'), { labels, series: revSeries, height: 168 });
  legend($('#l-revenue'), revSeries);

  // Overview — capital allocation donut
  donut($('#c-capital'), {
    height: 158,
    centerValue: money(s.inventory.cost + s.sales.cogs, { compact: true }),
    centerLabel: 'total cost',
    segments: [
      { label: 'Unsold inventory', value: s.inventory.cost, color: PALETTE.brass },
      { label: 'Sold (recovered)', value: s.sales.cogs, color: PALETTE.green }
    ]
  });

  // Overview — buying vs. selling (cash flow or unit flow)
  renderFlowChart(s);

  // Sales — profit bars
  barChart($('#c-profit'), {
    labels, height: 180,
    series: [{ name: 'Gross profit', color: PALETTE.green, values: s.buckets.map((b) => b.profit) }]
  });

  // Sales — scatter
  scatter($('#c-scatter'), { points: s.scatter, height: 190 });

  // Sales — time-to-sell distribution
  const speedBuckets = [
    ['0–7 d', 0, 7], ['8–30 d', 7, 30], ['31–60 d', 30, 60],
    ['61–90 d', 60, 90], ['91–180 d', 90, 180], ['180+ d', 180, Infinity]
  ];
  const sold = s.sales_rows.filter((i) => i.daysToSell != null);
  hbar($('#c-speed'), {
    rows: speedBuckets.map(([label, lo, hi]) => {
      const g = sold.filter((i) => i.daysToSell >= lo && i.daysToSell < hi);
      return {
        label,
        value: g.length,
        sub: `${g.length} items · ${money(g.reduce((a, i) => a + i.profit, 0))} profit`
      };
    }),
    format: (v) => `${int(v)} sold`,
    colorFor: (_, i) => [PALETTE.green, PALETTE.teal, PALETTE.blue, PALETTE.purple, PALETTE.brass, PALETTE.red][i]
  });

  // Inventory — aging
  hbar($('#c-aging'), {
    rows: s.aging.map((a) => ({ label: a.label, value: a.cost, sub: `${a.count} items · ${money(a.ask)} ask` })),
    format: (v) => money(v, { compact: true }),
    colorFor: (_, i) => [PALETTE.green, PALETTE.teal, PALETTE.blue, PALETTE.purple, PALETTE.brass, PALETTE.red][i]
  });

  // Inventory — price bands
  barChart($('#c-bands'), {
    labels: s.bands.map((b) => b.label), height: 170,
    series: [
      { name: 'On hand', color: PALETTE.brass, values: s.bands.map((b) => b.count) },
      { name: 'Sold in range', color: PALETTE.green, values: s.bands.map((b) => b.sold) }
    ],
    yFormat: (v) => int(v), tipFormat: (v) => `${int(v)} items`, integerY: true
  });

  // Catalog
  const cats = s.categories.slice(0, 9);
  hbar($('#c-cat-profit'), {
    rows: cats.map((c) => ({ label: c.name, value: c.profit, sub: `${c.sold} sold` })),
    format: (v) => money(v, { compact: true }),
    colorFor: (r) => (r.value >= 0 ? PALETTE.green : PALETTE.red)
  });
  hbar($('#c-cat-sell'), {
    rows: [...cats].sort((a, b) => b.sellThrough - a.sellThrough)
      .map((c) => ({ label: c.name, value: c.sellThrough, sub: `${c.sold} of ${c.total}` })),
    format: (v) => pct(v, 0),
    colorFor: () => PALETTE.brass
  });
}

/* ---------------------------------------------------------- items table */

const ITEM_COLUMNS = [
  { key: 'inv', title: '#', render: (r) => esc(r.inv || '—') },
  { key: 'desc', title: 'Description', render: (r) => esc(r.desc), cls: () => 'name' },
  { key: 'category', title: 'Category', render: (r) => esc(r.category) },
  { key: 'acquired', title: 'Acquired', num: true, render: (r) => (r.acquired ? new Date(r.acquired).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '—') },
  { key: 'cost', title: 'Cost', num: true, render: (r) => money(r.cost, { compact: true }) },
  { key: 'ask', title: 'Ask', num: true, render: (r) => (r.ask ? money(r.ask, { compact: true }) : '—') },
  { key: 'soldPrice', title: 'Sold', num: true, render: (r) => (r.isSold ? money(r.soldPrice, { compact: true }) : '<span class="pill hold">on hand</span>') },
  { key: 'profit', title: 'Profit', num: true, render: (r) => (r.profit == null ? '—' : money(r.profit, { compact: true })), cls: (r) => signClass(r.profit || 0) },
  { key: 'margin', title: 'Margin', num: true, render: (r) => (r.margin == null ? '—' : pct(r.margin, 0)) },
  { key: 'daysToSell', title: 'Days', num: true, render: (r) => days(r.daysToSell) }
];

function renderItems() {
  const s = state.stats;
  if (!s) return;
  const q = $('#item-search').value.trim().toLowerCase();
  const filter = $('#item-filter').value;

  let rows = state.ledger.filter((i) => {
    const acq = i.acquired == null || (i.acquired >= state.start && i.acquired <= state.end);
    const sld = i.sold != null && i.sold >= state.start && i.sold <= state.end;
    const held = i.acquired != null && i.acquired <= state.end && (i.sold == null || i.sold > state.end);
    return acq || sld || held;
  });

  if (filter === 'onhand') rows = rows.filter((i) => !i.isSold);
  else if (filter === 'sold') rows = rows.filter((i) => i.isSold);
  else if (filter === 'loss') rows = rows.filter((i) => i.isSold && i.profit < 0);
  else if (filter === 'noprice') rows = rows.filter((i) => !i.isSold && i.ask <= 0);

  if (q) rows = rows.filter((i) => i.desc.toLowerCase().includes(q) || String(i.inv).toLowerCase().includes(q));

  const { key, dir } = state.itemSort;
  rows = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });

  const shown = rows.slice(0, 400);
  const head = ITEM_COLUMNS.map((c) =>
    `<th class="sortable ${c.num ? 'num' : ''}" data-key="${c.key}">${c.title}${key === c.key ? `<span class="arrow"> ${dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('');
  const body = shown.map((r) =>
    `<tr>${ITEM_COLUMNS.map((c) => `<td class="${c.num ? 'num ' : ''}${c.cls ? c.cls(r) : ''}">${c.render(r)}</td>`).join('')}</tr>`).join('');

  $('#t-items').innerHTML = rows.length
    ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
      (rows.length > shown.length ? `<div class="empty-row">Showing first ${shown.length} of ${rows.length} items</div>` : '')
    : '<div class="empty-row">No items match those filters</div>';

  $$('#t-items th.sortable').forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.key;
      state.itemSort = { key: k, dir: state.itemSort.key === k ? -state.itemSort.dir : -1 };
      renderItems();
    };
  });
}

/* ---------------------------------------------------------------- render */

function render() {
  if (!state.items.length) return;
  showEmptyState(false);
  if (state.preset === 'custom') {
    state.start = fromInput($('#from').value);
    state.end = endOfDay(fromInput($('#to').value));
  }
  const s = analyze(state.ledger, { start: state.start, end: state.end }, state.venue.kind === 'all' ? null : state.venue);
  state.stats = s;
  state.rentInfo = currentRent();
  state.quailStats = state.quailSales.length
    ? analyzeQuail(scopedQuailSales(), { start: state.start, end: state.end, rentCents: state.rentInfo.cents })
    : null;
  refreshPalette();

  renderKpis(s);
  renderCharts(s);
  renderTables(s);
  renderHealth(s);
  renderVenues(s);
  renderPosCharts();
  renderReconcile();
  renderPosLedger();
  renderItems();

  const fmt = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const scope = s.venue
    ? ` · sales scoped to ${venueLabel(s.venue.id, s.venue.kind)} (stock on hand stays account-wide)`
    : '';
  const build = chrome.runtime.getManifest().version;
  $('#footnote').innerHTML =
    `${fmt(state.start)} – ${fmt(state.end)} · ${int(s.counts.total)} items tracked · ` +
    `${int(s.counts.sold)} sold, ${int(s.counts.onHand)} on hand in range` +
    `<span class="scope-note">${esc(scope)}</span>` +
    `<span class="muted-inline"> · v${esc(build)}</span>`;
}

/** Toggles the "nothing synced yet" placeholder without destroying the dashboard DOM. */
function showEmptyState(on = true) {
  $('#empty-state').classList.toggle('hidden', !on);
  $('#main').classList.toggle('no-data', on);
}

/* ------------------------------------------------------------------ data */

function send(type, payload = {}) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...payload }, resolve));
}

function loadInto(res) {
  state.items = normalize(res.items || []);
  if (res.venues) state.venueInfo = res.venues;
  state.quail = res.quail || state.quail;
  state.quailSales = state.quail ? normalizeQuailSales(state.quail.sales) : [];
  rebuildLedger();
  state.venueList = listVenues(state.items);
  if (state.venue.kind !== 'all') {
    const pool = state.venue.kind === 'store' ? state.venueList.stores : state.venueList.booths;
    if (!pool.some((v) => v.id === state.venue.id)) state.venue = { kind: 'all', id: null };
  }
  renderVenueSelector();
  state.meta = res.meta || null;
  if (!state.items.length) { showEmptyState(); return false; }
  // First paint must honour the restored mode's default, not a fixed range.
  if (state.start == null) applyPreset(defaultPresetFor(state.mode));
  renderPresets();
  render();
  return true;
}

function updateSubline() {
  const m = state.meta;
  $('#subline').textContent = m
    ? `${m.user || 'Signed in'} · ${int(m.count)} items · updated ${relativeTime(m.fetchedAt)}`
    : 'Not synced yet — fetch your data to begin';
}

async function refresh() {
  const btn = $('#refresh');
  btn.disabled = true;
  btn.classList.add('loading');
  $('#refresh-label').textContent = 'Fetching…';
  banner('');
  try {
    const res = await send('refresh');
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not reach the extension background worker.');
    loadInto(res);
    updateSubline();
    const v = res.venues || { stores: {}, booths: {}, errors: [] };
    const storeCount = Object.keys(v.stores || {}).length;
    const boothCount = Object.keys(v.booths || {}).length;
    const venuePart = storeCount || boothCount
      ? ` · ${storeCount} store${storeCount === 1 ? '' : 's'}, ${boothCount} booth${boothCount === 1 ? '' : 's'}`
      : '';
    if (v.errors && v.errors.length) {
      banner(`Synced ${int(res.meta.count)} items, but ${v.errors.length} venue lookup(s) failed: ${v.errors[0]}`, 'info');
    } else {
      const posPart = res.quail ? ` · ${int(res.quail.sales.length)} POS sales` : '';
      banner(`Synced ${int(res.meta.count)} items${venuePart}${posPart}.`, 'ok');
      setTimeout(() => banner(''), 3200);
    }
  } catch (e) {
    banner(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    $('#refresh-label').textContent = 'Fetch latest data';
  }
}

/* ------------------------------------------------------------------ init */

function initNav() {
  let mode = null;
  try {
    mode = localStorage.getItem('sp_mode');
  } catch (e) { /* fall through to the default mode */ }
  state.mode = MODES.some((m) => m.id === mode) ? mode : MODES[0].id;
  const active = modeById(state.mode);
  let tab = null;
  try {
    tab = localStorage.getItem('sp_tab_' + state.mode);
  } catch (e) { /* fall through to the first tab */ }
  state.tab = active.tabs.some(([id]) => id === tab) ? tab : active.tabs[0][0];
  renderModes();
  renderTabs();
}

async function init() {
  if (new URLSearchParams(location.search).get('full') === '1') {
    document.body.classList.add('expanded');
    $('#expand').style.display = 'none';
  }
  initNav();
  renderPresets();

  $('#refresh').onclick = refresh;
  $('#expand').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?full=1') });
  $('#theme-toggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('sp_theme', next);
    } catch (e) { /* the toggle still works for this session */ }
    hideTip();
    if (state.stats) render();
  };

  const wireToggle = (id, key, redraw) => {
    $$(`#${id} button`).forEach((btn) => {
      btn.onclick = () => {
        state[key] = btn.dataset.mode;
        $$(`#${id} button`).forEach((b) => b.classList.toggle('active', b === btn));
        redraw();
      };
    });
  };
  wireToggle('flow-mode', 'flowMode', () => { if (state.stats) renderFlowChart(state.stats); });
  wireToggle('dow-mode', 'dowMode', () => { if (state.quailStats) renderDowChart(state.quailStats); });
  wireToggle('hour-mode', 'hourMode', () => { if (state.quailStats) renderHourChart(state.quailStats); });
  $('#venue').onchange = () => {
    const v = $('#venue').value;
    state.venue = v === 'all'
      ? { kind: 'all', id: null }
      : { kind: v.slice(0, v.indexOf(':')), id: v.slice(v.indexOf(':') + 1) };
    render();
  };
  $('#item-search').oninput = renderItems;
  ['severity', 'match', 'type'].forEach((key) => {
    $('#f-' + key).onchange = (e) => {
      state.findingFilters[key] = e.target.value;
      renderReconcile();
    };
  });
  $('#pos-search').oninput = renderPosLedger;
  $('#pos-method').onchange = renderPosLedger;
  $('#item-filter').onchange = renderItems;
  ['#from', '#to'].forEach((sel) => {
    $(sel).onchange = () => { state.preset = 'custom'; renderPresets(); render(); };
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(repaintCharts, 140);
  });

  try {
    const stored = await chrome.storage.local.get(['sp_venue_names', 'sp_venues']);
    state.venueNames = stored.sp_venue_names || {};
    state.venueInfo = stored.sp_venues || { stores: {}, booths: {} };
  } catch (e) { /* names are cosmetic; fall back to short ids */ }

  // If the worker predates this popup, every background change (venue lookups
  // included) is silently absent. Detect it instead of leaving the user guessing.
  const expected = chrome.runtime.getManifest().version;
  const pong = await send('ping');
  if (!pong || !pong.ok || pong.build !== expected) {
    const running = pong && pong.build ? `build ${pong.build}` : 'an older build';
    banner(`The background service worker is running ${running}, but this popup is ${expected}. `
      + 'Open chrome://extensions and click the reload (\u21bb) icon on Roost.', 'error');
  }

  const cached = await send('getCache');
  if (cached && cached.ok && cached.items && cached.items.length) {
    loadInto(cached);
    updateSubline();
    const age = Date.now() - (cached.meta ? cached.meta.fetchedAt : 0);
    if (age > 12 * 3600 * 1000) banner('This data is over 12 hours old — fetch again for the latest.', 'info');
  } else {
    showEmptyState();
    updateSubline();
    const session = await send('getSession');
    if (!session || !session.ok) banner((session && session.error) || 'Sign in to Sandpiper first.', 'error');
  }
}

init();
