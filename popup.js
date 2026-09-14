/* Roost — popup controller. */

import { normalize, analyze, dataBounds, listVenues, shortId, UNASSIGNED, DAY } from './lib/analytics.js';
import { normalizeQuailSales, analyzeQuail } from './lib/quail.js';
import { reconcile } from './lib/reconcile.js';
import { planResolution, buildVenueContext, CONFIDENCE } from './lib/resolve.js';
import { buildLedger, rentForRange } from './lib/ledger.js';
import {
  nextInventoryNumber, takenNumbers, numberKey, priceHistory, margin,
  splitLotCost, blankRow, isRowEmpty, validateRow, draftNumberCounts,
  buildCreatePayload, draftTotals
} from './lib/stock.js';
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
  dayMode: 'money',
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
  // Draft stock, kept until it is written or explicitly discarded.
  addStock: { open: false, acquired: null, rows: [], lotCents: null, busy: false },
  // Records → Items: which row is open for editing, and what is about to be
  // deleted once it has been confirmed.
  itemEditing: null,
  itemConfirmDelete: null,
  itemBusy: false,
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
  /* What the store actually hands over. Rent is the store's money, not a cost
   * of the goods, so it comes out of the payout rather than out of profit —
   * and taking it here leaves net profit at exactly the figure it always was,
   * since (net payout - rent) - cost of goods is the same arithmetic in a more
   * honest order. */
  const takeHome = s.sales.net - rentInfo.cents;
  const netMargin = s.sales.gross > 0 ? netProfit / s.sales.gross : null;
  const staleShare = s.inventory.units ? s.inventory.stale / s.inventory.units : 0;
  /* Only label the comparison when there is one; an empty prior window used to
   * leave a bare "vs prior period" hanging off a figure with nothing behind it. */
  const withTrend = (text, current, prior) => {
    const t = trend(current, prior, prev);
    return t ? `${text} ${t} vs prior` : text;
  };

  /* Standard consignment-retail vocabulary, used identically everywhere. One
   * deduction per card, in the order the money actually leaves:
   * gross sales -> commission -> net payout -> booth rent -> take-home
   * -> cost of goods -> net profit.
   *
   * Gross profit sits between net payout and cost of goods on that same
   * ladder, but it is the one rung that ignores rent, which makes it the
   * weakest of the five to lead with. It keeps its place on the Sales tab. */
  $('#kpis').innerHTML = [
    kpi('Gross sales', money(s.sales.gross, { compact: true }),
      withTrend(plural(s.counts.sold, 'sale'), s.sales.gross, prev.gross),
      { exact: money(s.sales.gross) }),
    kpi('Net payout', money(s.sales.net, { compact: true }),
      withTrend(`less ${money(s.sales.commissions, { compact: true })} commission`, s.sales.net, prev.net),
      { exact: money(s.sales.net) }),
    kpi('Take-home', money(takeHome, { compact: true }),
      rentInfo.partial
        ? `less rent ${money(rentInfo.cents, { compact: true })} of ${money(rentInfo.full, { compact: true })} so far`
        : `less ${money(rentInfo.cents, { compact: true })} booth rent`,
      { status: bandSign(takeHome), exact: money(takeHome) }),
    kpi('Net profit', money(netProfit, { compact: true }),
      `less ${money(s.sales.cogs, { compact: true })} cost of goods${netMargin == null ? '' : ` · ${pct(netMargin)} margin`}`,
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

/**
 * Takes a finding to the rows behind it.
 *
 * The window travels with the click. Records keeps its own range, so landing
 * there on its 90-day default after clicking a figure computed over all time
 * would list a different set of items than the number that was clicked — which
 * is exactly the kind of quiet disagreement the single ledger exists to avoid.
 * Seeding the remembered range before switching means selectMode restores it as
 * if Records had been showing that window all along.
 */
function jumpToItems(filter) {
  state.ranges.records = { preset: state.preset, start: state.start, end: state.end };
  $('#item-filter').value = filter;
  $('#item-search').value = '';
  selectMode('records');
  selectTab('items');
}

function renderHealth(s) {
  const rows = [];
  /* `to` is what makes a finding a thing you can act on rather than a thing you
   * are told: a filter to see the offending items, or a mode to go and fix
   * them in. Findings that describe a rate rather than a set of rows have no
   * destination, and stay as text. */
  const add = (tone, text, val, to = null) => rows.push({ tone, text, val, to });
  const color = { good: PALETTE.green, warn: PALETTE.brass, bad: PALETTE.red };

  add(s.counts.unpriced ? 'warn' : 'good',
    `<b>${int(s.counts.unpriced)}</b> unsold items have no asking price`,
    s.counts.unpriced ? 'Needs pricing' : 'All priced',
    s.counts.unpriced ? { filter: 'noprice' } : null);
  add(s.counts.zeroCost ? 'warn' : 'good',
    `<b>${int(s.counts.zeroCost)}</b> unsold items are recorded at $0 cost`,
    s.counts.zeroCost ? 'Check costs' : 'Costs set',
    s.counts.zeroCost ? { filter: 'zerocost' } : null);
  add(s.inventory.stale > s.inventory.units * 0.3 ? 'bad' : s.inventory.stale ? 'warn' : 'good',
    `<b>${int(s.inventory.stale)}</b> items have been held over 180 days`,
    money(s.inventory.staleCost, { compact: true }),
    s.inventory.stale ? { filter: 'aged' } : null);
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
      led.costUnknown ? 'profit is optimistic' : 'costs complete',
      led.costUnknown ? { mode: 'review' } : null);
    add(led.corrected ? 'warn' : 'good',
      led.corrected
        ? `<b>${int(led.corrected)}</b> sale(s) use register values where Sandpiper disagreed`
        : 'Sandpiper matches the register on every sale',
      led.corrected ? 'see Anomalies' : 'in step',
      led.corrected ? { mode: 'review' } : null);
  }

  $('#health').innerHTML = rows.map((r, i) => {
    const tag = r.to ? 'button' : 'div';
    const extra = r.to
      ? ` data-i="${i}" title="${r.to.mode ? 'Open Review' : 'Show these items'}"`
      : '';
    return `<${tag} class="health-row${r.to ? ' actionable' : ''}"${extra}>
      <span class="health-icon" style="background:${color[r.tone]}"></span>
      <span class="health-text">${r.text}</span>
      <span class="health-val" style="color:${color[r.tone]}">${r.val}</span>
      <span class="health-go" aria-hidden="true">${r.to ? '→' : ''}</span>
    </${tag}>`;
  }).join('');

  $$('#health .health-row.actionable').forEach((el) => {
    const to = rows[Number(el.dataset.i)].to;
    el.onclick = () => (to.mode ? selectMode(to.mode) : jumpToItems(to.filter));
  });
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

/** Rent rows for the selected booth, or all of them when nothing is scoped. */
function scopedRentRows() {
  const rows = (state.quail && state.quail.rent) || [];
  const boothId = scopedBoothExternalId();
  return boothId == null ? rows : rows.filter((r) => r.boothId === boothId);
}

/** Rent for the window, narrowed to the selected booth so it matches the sales beside it. */
function currentRent() {
  return rentForRange(scopedRentRows(), state.start, state.end);
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
    ['#c-daily', '#c-dow', '#c-hour', '#c-rent'].forEach((sel) => empty($(sel), 'No POS data'));
    $('#t-recent').innerHTML = '';
    return;
  }
  if (note) note.hidden = true;
  const q = state.quailStats;
  if (!q) return;

  renderDailyChart(q);
  renderDowChart(q);
  renderHourChart(q);

  renderRentChart();

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
/**
 * Whether the booth is worth keeping.
 *
 * Rent is the one cost that arrives whether or not anything sells, so the
 * question a dealer actually has to answer each month is whether the booth
 * cleared it. "Rent covered" answers that for the selected window as a single
 * percentage, which says nothing about direction — a booth sliding from 300% to
 * 90% over a year and one climbing the other way read identically.
 *
 * Twelve months regardless of the range, because a trend needs a length of its
 * own: reading it through a 30-day window would leave one bar and no trend.
 */
function renderRentChart() {
  const rentRows = scopedRentRows();
  const box = $('#c-rent');
  if (!box) return;
  if (!rentRows.length) {
    $('#l-rent').innerHTML = '';
    return empty(box, 'No booth rent recorded');
  }

  const now = new Date();
  const months = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push({
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      start: d.getTime(),
      end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime()
    });
  }

  /* Sales-derived, so it follows the venue scope like every other sales figure;
   * the range is deliberately ignored. */
  const v = state.venue;
  const inScope = (i) => !v || v.kind === 'all' || !v.id
    || (v.kind === 'store' ? i.store : i.booth) === (v.id === UNASSIGNED ? null : v.id);
  const sales = state.ledger.filter((i) => i.isSold && i.sold != null && inScope(i));

  const payout = months.map((m) =>
    sales.reduce((a, i) => a + (i.sold >= m.start && i.sold <= m.end ? i.net : 0), 0));
  /* rentForRange prorates the month in progress, so today does not read as a
   * loss against a full month's rent that is not owed yet. */
  const rent = months.map((m) => rentForRange(rentRows, m.start, m.end).cents);

  const series = [
    { name: 'Net payout', color: PALETTE.green, values: payout },
    { name: 'Booth rent', color: PALETTE.brass, values: rent }
  ];

  barChart(box, {
    labels: months.map((m) => m.label),
    series,
    height: 158,
    tipFormat: (val, ser, i) => {
      const left = payout[i] - rent[i];
      return ser.name === 'Net payout'
        ? `${money(payout[i])}`
        : `${money(rent[i])} · ${left >= 0 ? 'kept' : 'short'} ${money(Math.abs(left))}`;
    }
  });
  legend($('#l-rent'), series);
}

function renderDailyChart(q) {
  const asMoney = state.dayMode === 'money';
  const series = [{
    name: asMoney ? 'Gross sales' : 'Items sold',
    color: PALETTE.blue,
    values: q.days.map((d) => (asMoney ? d.gross : d.units))
  }];
  barChart($('#c-daily'), {
    labels: q.days.map((d) => d.label),
    series,
    height: 180,
    // Items are whole things, so a fractional tick would be describing nothing.
    integerY: !asMoney,
    yFormat: asMoney ? (v) => money(v, { compact: true }) : (v) => int(v),
    // Whichever is being charted, the tooltip reports both.
    tipFormat: (v, ser, i) => (asMoney
      ? `${money(q.days[i].gross)} · ${int(q.days[i].units)} items`
      : `${int(q.days[i].units)} items · ${money(q.days[i].gross)}`)
  });
  legend($('#l-daily'), series);
}

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
  /* Rent is billed monthly but the buckets can be days or quarters, so it is
   * accrued bucket by bucket and carried forward. Without that the net profit
   * line would only step down once a month regardless of the axis. */
  const rentRows = scopedRentRows();
  let rentSoFar = 0;
  const cumulativeNetProfit = s.buckets.map((b, i) => {
    rentSoFar += rentForRange(rentRows, b.t, Math.min(b.next - 1, state.end)).cents;
    return s.cumulative[i].profit - rentSoFar;
  });

  const cumSeries = [
    { name: 'Net payout', color: PALETTE.blue, values: s.cumulative.map((b) => b.net) },
    { name: 'Gross profit', color: PALETTE.green, values: s.cumulative.map((b) => b.profit) }
  ];
  // Only worth a third line when rent is actually known; otherwise it just traces
  // the gross profit line exactly.
  if (rentSoFar > 0) {
    cumSeries.push({ name: 'Net profit, after rent', color: PALETTE.brass, values: cumulativeNetProfit });
  }
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

const shortDate = (t) =>
  new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });

/** yyyy-mm-dd in local time, which is what <input type="date"> expects. */
const dateInputValue = (t) => {
  if (!t) return '';
  const d = new Date(t);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/* Midday, so a date that crosses a timezone on its way to the API and back
 * still lands on the day the user picked. */
const unixFromDateInput = (v) => (v ? Math.floor(new Date(`${v}T12:00:00`).getTime() / 1000) : null);

/* Widths are declared rather than discovered. The table is laid out fixed, so
 * a row swapping its text for input fields cannot resize a column and shunt
 * every number sideways — the two date columns are the worst of it, since a
 * native date field is several times wider than "Sep 9, 26".
 *
 * Percentages, summing to 100 with the action column. */
const ITEM_COLUMNS = [
  { key: 'inv', title: '#', w: 7, render: (r) => esc(r.inv || '—') },
  { key: 'desc', title: 'Description', w: 17, render: (r) => esc(r.desc), cls: () => 'name' },
  { key: 'category', title: 'Category', w: 9, render: (r) => esc(r.category) },
  { key: 'acquired', title: 'Acquired', w: 11, num: true, render: (r) => (r.acquired ? shortDate(r.acquired) : '—') },
  { key: 'cost', title: 'Cost', w: 7, num: true, render: (r) => money(r.cost, { compact: true }) },
  { key: 'ask', title: 'Ask', w: 7, num: true, render: (r) => (r.ask ? money(r.ask, { compact: true }) : '—') },
  { key: 'sold', title: 'Sold on', w: 11, num: true, render: (r) => (r.sold ? shortDate(r.sold) : '—') },
  { key: 'soldPrice', title: 'Sold for', w: 7, num: true, render: (r) => (r.isSold ? money(r.soldPrice, { compact: true }) : '<span class="pill hold">on hand</span>') },
  { key: 'profit', title: 'Profit', w: 7, num: true, render: (r) => (r.profit == null ? '—' : money(r.profit, { compact: true })), cls: (r) => signClass(r.profit || 0) },
  { key: 'margin', title: 'Margin', w: 5, num: true, render: (r) => (r.margin == null ? '—' : pct(r.margin, 0)) },
  { key: 'daysToSell', title: 'Days', w: 5, num: true, render: (r) => days(r.daysToSell) }
];

const ITEM_ACTS_W = 7;
const itemColgroup = () =>
  '<colgroup>'
  + ITEM_COLUMNS.map((c) => `<col style="width:${c.w}%">`).join('')
  + `<col style="width:${ITEM_ACTS_W}%"></colgroup>`;

function renderItems() {
  const s = state.stats;
  if (!s) return;
  const q = $('#item-search').value.trim().toLowerCase();
  const filter = $('#item-filter').value;

  /* Sandpiper's own records, not the merged ledger. Records is where you go to
   * find a thing in the system that holds it, so each page answers for one
   * system: Items is what Sandpiper believes, POS sales is what the register
   * rang up. Analyze reads the ledger, because a business figure has to
   * reconcile both; Review is where the two are held against each other. */
  let rows = state.items.filter((i) => {
    const acq = i.acquired == null || (i.acquired >= state.start && i.acquired <= state.end);
    const sld = i.sold != null && i.sold >= state.start && i.sold <= state.end;
    const held = i.acquired != null && i.acquired <= state.end && (i.sold == null || i.sold > state.end);
    return acq || sld || held;
  });

  /* "On hand" means on hand at the end of the window, which is the same test
   * analytics uses for every stock figure — so a count clicked on Overview and
   * the rows listed here are the same items, not two nearly-equal sets. */
  const heldAtEnd = (i) =>
    i.acquired != null && i.acquired <= state.end && (i.sold == null || i.sold > state.end);
  const ageAtEnd = (i) => (i.acquired != null ? (state.end - i.acquired) / DAY : null);

  if (filter === 'onhand') rows = rows.filter(heldAtEnd);
  else if (filter === 'sold') rows = rows.filter((i) => i.isSold);
  else if (filter === 'loss') rows = rows.filter((i) => i.isSold && i.profit < 0);
  else if (filter === 'noprice') rows = rows.filter((i) => heldAtEnd(i) && i.ask <= 0);
  else if (filter === 'zerocost') rows = rows.filter((i) => heldAtEnd(i) && i.cost <= 0);
  else if (filter === 'aged') rows = rows.filter((i) => heldAtEnd(i) && (ageAtEnd(i) || 0) > 180);


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

  /* An editor left open on a row the filters have since hidden would be
   * invisible and still live, so it closes with the row. */
  const visible = new Set(shown.map((r) => r.id));
  if (state.itemEditing && !visible.has(state.itemEditing)) state.itemEditing = null;

  const head =
    ITEM_COLUMNS.map((c) =>
      `<th class="sortable ${c.num ? 'num' : ''}" data-key="${c.key}">${c.title}${key === c.key ? `<span class="arrow"> ${dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('') +
    '<th class="row-acts"></th>';

  const body = shown.map((r) => (state.itemEditing === r.id ? itemEditorRow(r) : itemRow(r))).join('');

  $('#t-items').innerHTML = rows.length
    ? `<table class="items-table">${itemColgroup()}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
      (rows.length > shown.length ? `<div class="empty-row">Showing first ${shown.length} of ${rows.length} items</div>` : '')
    : '<div class="empty-row">No items match those filters</div>';

  $$('#t-items th.sortable').forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.key;
      state.itemSort = { key: k, dir: state.itemSort.key === k ? -state.itemSort.dir : -1 };
      renderItems();
    };
  });

  /* The row is the target, not a button on it: by the time you have found the
   * thing you want to correct, your pointer is already on it. Buttons and the
   * fields of an open editor are excluded so they still do their own job. */
  $$('#t-items tr.editable').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest('button, input, select, a')) return;
      if (window.getSelection && String(window.getSelection()).length) return;  // let text be copied

      /* Clicking a row is easy to do by accident in a way that pressing an Edit
       * button was not, so an open editor with changes in it is never thrown
       * away silently — it stays put and says so. */
      const open = state.itemEditing && state.items.find((r) => r.id === state.itemEditing);
      if (open && open.id !== tr.dataset.id && collectItemChanges(open).length) {
        banner('Save or cancel your changes first.', 'info');
        setTimeout(() => banner(''), 2400);
        return;
      }
      state.itemEditing = tr.dataset.id;
      renderItems();
    };
  });
  $$('#t-items .act-del').forEach((b) => {
    b.onclick = () => confirmItemDelete([b.dataset.id]);
  });

  const editing = state.itemEditing && shown.find((r) => r.id === state.itemEditing);
  if (editing) {
    $('#t-items .act-save').onclick = () => saveItemEdit(editing);
    $('#t-items .act-cancel').onclick = () => { state.itemEditing = null; renderItems(); };
    const first = $('#t-items .e-desc');
    if (first) first.focus();
  }

  renderItemBar();
}

function itemRow(r) {
  return `<tr class="editable" data-id="${esc(r.id)}" title="Click to edit">`
    + ITEM_COLUMNS.map((c) => `<td class="${c.num ? 'num ' : ''}${c.cls ? c.cls(r) : ''}">${c.render(r)}</td>`).join('')
    + `<td class="row-acts"><button class="row-act act-del" data-id="${esc(r.id)}" title="Delete this item">Delete</button></td></tr>`;
}

/**
 * The row, in place, as fields.
 *
 * Editing where the row already is keeps the item's own numbers either side of
 * what you are changing — a dialog would take the comparison away exactly when
 * you want it. Derived columns stay blank while editing rather than showing
 * arithmetic that no longer matches the fields above them.
 */
function itemEditorRow(r) {
  const cents = (v) => (v == null ? '' : (v / 100).toFixed(2));
  return `<tr class="editing">
    <td><input class="e-inv" value="${esc(r.inv)}" aria-label="Inventory number"></td>
    <td><input class="e-desc" value="${esc(r.desc === '(no description)' ? '' : r.desc)}" aria-label="Description"></td>
    <td class="muted">${esc(r.category)}</td>
    <td><input type="date" class="e-acquired" value="${dateInputValue(r.acquired)}" aria-label="Acquired date"></td>
    <td><input class="e-cost num" value="${cents(r.cost)}" inputmode="decimal" aria-label="Cost"></td>
    <td><input class="e-ask num" value="${cents(r.ask)}" inputmode="decimal" aria-label="Asking price"></td>
    <td><input type="date" class="e-sold" value="${dateInputValue(r.sold)}" aria-label="Sold date"></td>
    <td><input class="e-soldPrice num" value="${cents(r.soldPrice)}" inputmode="decimal" aria-label="Sold price"></td>
    <!-- The buttons take the three derived columns with them. Those cells are
         blank while editing anyway, and it buys Save and Cancel room without
         widening the action column for every ordinary row. -->
    <td colspan="4" class="row-acts">
      <button class="row-act act-save">Save</button>
      <button class="row-act act-cancel">Cancel</button>
    </td>
  </tr>`;
}

/**
 * Turns the edited fields into the smallest set of changes that says what
 * moved, in the raw API's own names and units — cents for money, whole seconds
 * for dates. Cost keeps any restoration recorded against the item: originalCost
 * is what you typed, totalCost carries the expenses that were already there.
 */
function collectItemChanges(r) {
  const val = (cls) => { const el = $('#t-items .e-' + cls); return el ? el.value : null; };
  const cents = (v) => { const n = Number(String(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : null; };
  const changes = [];

  const inv = String(val('inv') || '').trim();
  if (inv !== r.inv) changes.push({ field: 'inventoryNumber', to: inv });

  const desc = String(val('desc') || '').trim();
  const was = r.desc === '(no description)' ? '' : r.desc;
  if (desc !== was) changes.push({ field: 'description', to: desc });

  const acq = unixFromDateInput(val('acquired'));
  if (acq !== (r.acquired == null ? null : Math.round(r.acquired / 1000))) {
    changes.push({ field: 'acquired', to: acq || 0 });
  }

  const cost = cents(val('cost'));
  if (cost != null && cost !== r.cost) {
    changes.push({ field: 'originalCost', to: cost });
    changes.push({ field: 'totalCost', to: cost + (r.restoration || 0) });
  }

  const ask = cents(val('ask'));
  if (ask != null && ask !== r.ask) changes.push({ field: 'askingPrice', to: ask });

  /* Only offered for something already sold. Clearing a sale is Sandpiper's
   * unsell, a different endpoint with different consequences. */
  if (r.isSold) {
    const sold = unixFromDateInput(val('sold'));
    if (sold && sold !== Math.round(r.sold / 1000)) changes.push({ field: 'sold', to: sold });
    const sp = cents(val('soldPrice'));
    if (sp != null && sp !== r.soldPrice) changes.push({ field: 'soldPrice', to: sp });
  }
  return changes;
}

async function saveItemEdit(r) {
  const changes = collectItemChanges(r);
  if (!changes.length) { state.itemEditing = null; renderItems(); return; }

  const inv = String(($('#t-items .e-inv') || {}).value || '').trim();
  if (!inv) { banner('An item needs an inventory number.', 'error'); return; }
  const clash = takenNumbers(state.items.filter((i) => i.id !== r.id)).get(numberKey(inv));
  if (clash) { banner(`#${inv} is already "${clash.desc}".`, 'error'); return; }

  state.itemBusy = true;
  renderItemBar();
  try {
    const res = await send('applyEdits', { plans: [{ itemId: r.id, changes }] });
    if (!res || !res.ok) throw new Error((res && res.error) || 'The edit request failed.');
    const bad = res.results.find((x) => !x.ok);
    if (bad) throw new Error(bad.error);

    state.items = normalize(res.items);
    state.venueList = listVenues(state.items);
    rebuildLedger();
    state.itemEditing = null;
    banner(`Updated #${inv}.`, 'ok');
    setTimeout(() => banner(''), 2600);
    render();
  } catch (e) {
    banner(e.message, 'error');
  } finally {
    state.itemBusy = false;
    renderItemBar();
  }
}

/* --- deleting ------------------------------------------------------------ */

function confirmItemDelete(ids) {
  state.itemConfirmDelete = ids.filter(Boolean);
  renderItemBar();
  $('#item-bar').scrollIntoView({ block: 'nearest' });
}

/**
 * Deleting is the one thing here that cannot be undone, so it always names what
 * it is about to remove and never fires on a single click.
 */
function renderItemBar() {
  const bar = $('#item-bar');
  if (!bar) return;
  const pending = state.itemConfirmDelete;

  if (!pending || !pending.length) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }

  const named = pending
    .map((id) => state.items.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => `#${esc(r.inv || '—')} ${esc(r.desc)}`);
  bar.hidden = false;
  bar.innerHTML = `<span class="count">Delete <b>${esc(named.join(', '))}</b> from Sandpiper? This cannot be undone.</span>
    <button class="fix-btn" id="del-cancel">Cancel</button>
    <button class="fix-btn danger" id="del-go"${state.itemBusy ? ' disabled' : ''}>${state.itemBusy ? 'Deleting…' : 'Delete'}</button>`;
  $('#del-cancel').onclick = () => { state.itemConfirmDelete = null; renderItemBar(); };
  $('#del-go').onclick = () => doItemDelete(pending);
}

async function doItemDelete(ids) {
  state.itemBusy = true;
  renderItemBar();
  try {
    const res = await send('deleteItems', { ids });
    if (!res || !res.ok) throw new Error((res && res.error) || 'The delete request failed.');
    const failed = res.results.find((r) => !r.ok);

    state.items = normalize(res.items);
    state.venueList = listVenues(state.items);
    rebuildLedger();
    state.itemConfirmDelete = null;

    banner(
      failed
        ? `Deleted ${int(res.deleted)} of ${int(ids.length)}, then stopped: ${failed.error}`
        : `Deleted ${int(res.deleted)} item${res.deleted === 1 ? '' : 's'}.`,
      failed ? 'error' : 'ok'
    );
    if (!failed) setTimeout(() => banner(''), 2800);
    render();
  } catch (e) {
    banner(e.message, 'error');
  } finally {
    state.itemBusy = false;
    renderItemBar();
  }
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


/* ======================================================================= Add stock

   Sandpiper adds one item per modal: open it, type six fields, save, open it
   again. That is the wrong shape for how stock actually arrives — you come back
   from a pick with a box, not with an item. This is a grid you type down, with
   the three things Sandpiper cannot tell you because it only knows the row in
   front of it: whether the number is free, what things like this have sold for,
   and what you keep after the store's cut. */

const DRAFT_KEY = 'sp_stock_draft';

/** Cents from whatever the user typed, or null for an empty field. */
function centsFrom(text) {
  const raw = String(text == null ? '' : text).replace(/[^0-9.]/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const centsTo = (c) => (c == null ? '' : (c / 100).toFixed(2));

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** The commission the store has actually been charging, for the margin column. */
const stockCommission = () =>
  (state.stats && state.stats.inventory && state.stats.inventory.commissionRate) || 0.15;

function openAddStock() {
  const as = state.addStock;
  as.open = true;
  if (!as.acquired) as.acquired = todayISO();
  if (!as.rows.length) as.rows = [blankRow(nextInventoryNumber(state.items))];   // one to start on
  $('#add-stock').hidden = false;
  renderAddStock();
  // Straight into the first description: the number is already right.
  const first = $('#as-grid .stock-row input.desc');
  if (first) first.focus();
}

function closeAddStock() {
  state.addStock.open = false;
  $('#add-stock').hidden = true;
  saveDraft();
}

/**
 * The next number for this batch, counting the rows already typed into it.
 *
 * Draft rows are handed the current time so they win the "series in use" test
 * in nextInventoryNumber: start typing A-016 into a shop full of 0xxxx and the
 * rows after it follow you, rather than snapping back to the old scheme.
 */
function nextDraftNumber() {
  const now = Math.floor(Date.now() / 1000);
  const drafts = state.addStock.rows
    .filter((r) => String(r.inv || '').trim())
    .map((r) => ({ inv: r.inv, acquired: now }));
  return nextInventoryNumber([...state.items, ...drafts]);
}

/** Adds a row. Only ever called from the button or Enter — never from typing. */
function addStockRow() {
  state.addStock.rows.push(blankRow(nextDraftNumber()));
}

function saveDraft() {
  const as = state.addStock;
  const rows = as.rows.filter((r) => !isRowEmpty(r));
  try {
    if (rows.length) chrome.storage.local.set({ [DRAFT_KEY]: { acquired: as.acquired, rows } });
    else chrome.storage.local.remove(DRAFT_KEY);
  } catch (e) { /* a lost draft is not worth breaking the screen over */ }
}

async function loadDraft() {
  try {
    const got = await chrome.storage.local.get(DRAFT_KEY);
    const draft = got[DRAFT_KEY];
    if (draft && Array.isArray(draft.rows) && draft.rows.length) {
      state.addStock.rows = draft.rows;
      state.addStock.acquired = draft.acquired || todayISO();
      return draft.rows.length;
    }
  } catch (e) { /* no draft is the normal case */ }
  return 0;
}

/* --- rendering ----------------------------------------------------------- */

function renderAddStock() {
  const as = state.addStock;

  $('#as-acquired').value = as.acquired;
  $('#as-lot').value = centsTo(as.lotCents);

  const grid = $('#as-grid');
  grid.innerHTML = as.rows.length
    ? `<div class="stock-head">
      <span class="num">Inv #</span><span>Description</span>
      <span class="cost">Cost</span><span class="ask">Asking</span>
      <span class="qty">Qty</span><span class="nets">You keep</span><span></span>
    </div>`
    : '<p class="stock-empty">No rows. Add one to start entering stock.</p>';

  as.rows.forEach((row, i) => grid.appendChild(buildStockRow(row, i)));

  const more = document.createElement('button');
  more.className = 'stock-add';
  more.textContent = as.rows.length ? '+ Add row' : '+ Add a row';
  more.onclick = () => {
    addStockRow();
    renderAddStock();
    const inputs = $$('#as-grid .stock-row input.desc');
    if (inputs.length) inputs[inputs.length - 1].focus();
  };
  grid.appendChild(more);

  refreshAllRows();
  refreshTotals();
}

function buildStockRow(row, i) {
  const wrap = document.createElement('div');
  wrap.className = 'stock-row';
  wrap.dataset.i = String(i);
  wrap.innerHTML = `
    <input class="num"  value="${escapeAttr(row.inv)}"  aria-label="Inventory number" spellcheck="false">
    <input class="desc" value="${escapeAttr(row.desc)}" aria-label="Description" placeholder="What is it?">
    <input class="cost" value="${centsTo(row.costCents)}" aria-label="Cost"    inputmode="decimal" placeholder="0.00">
    <input class="ask"  value="${centsTo(row.askCents)}"  aria-label="Asking price" inputmode="decimal" placeholder="0.00">
    <input class="qty"  value="${row.qty || 1}" aria-label="Quantity" inputmode="numeric">
    <span class="stock-nets"></span>
    <button class="row-drop" title="Remove this row" aria-label="Remove row">×</button>`;

  const [num, desc, cost, ask, qty] = wrap.querySelectorAll('input');
  const read = () => {
    row.inv = num.value.trim();
    row.desc = desc.value;
    row.costCents = centsFrom(cost.value);
    row.askCents = centsFrom(ask.value);
    row.qty = Math.max(1, parseInt(qty.value, 10) || 1);
  };

  for (const el of [num, desc, cost, ask, qty]) {
    el.addEventListener('input', () => {
      read();
      refreshRow(Number(wrap.dataset.i));
      refreshTotals();
      queueDraftSave();
    });
  }

  // Money reads better settled than mid-keystroke.
  cost.addEventListener('blur', () => { read(); cost.value = centsTo(row.costCents); refreshRow(Number(wrap.dataset.i)); });
  ask.addEventListener('blur', () => { read(); ask.value = centsTo(row.askCents); refreshRow(Number(wrap.dataset.i)); });

  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    read();
    const idx = Number(wrap.dataset.i);
    const next = $$('#as-grid .stock-row')[idx + 1];
    if (next) { next.querySelector('input.desc').focus(); return; }
    addStockRow();
    renderAddStock();
    const all = $$('#as-grid .stock-row input.desc');
    if (all.length) all[all.length - 1].focus();
  });

  wrap.querySelector('.row-drop').onclick = () => {
    state.addStock.rows.splice(Number(wrap.dataset.i), 1);
    renderAddStock();   // an empty grid is allowed; it says so and offers a row
    queueDraftSave();
  };

  const note = document.createElement('div');
  note.className = 'row-note';
  wrap.appendChild(note);
  return wrap;
}

const escapeAttr = (s) => String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;');

let draftTimer = null;
function queueDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 400);
}

/**
 * A row's second line. Errors first, because they stop the write; then the
 * warnings worth a glance; and when a row is simply fine, what its like has
 * sold for — which is the number you actually want while deciding a price.
 */
function refreshRow(i) {
  const el = $$('#as-grid .stock-row')[i];
  const row = state.addStock.rows[i];
  if (!el || !row) return;

  const rate = stockCommission();
  const note = el.querySelector('.row-note');
  const numEl = el.querySelector('input.num');

  if (isRowEmpty(row)) {
    note.className = 'row-note';
    note.textContent = '';
    numEl.classList.remove('bad');
    el.querySelector('.stock-nets').textContent = '';
    return;
  }

  const v = validateRow(row, {
    taken: state.stockTaken,
    draftCounts: draftNumberCounts(state.addStock.rows),
    commissionRate: rate
  });
  numEl.classList.toggle('bad', v.errors.some((e) => e.includes('#')));

  if (v.errors.length) {
    note.className = 'row-note err';
    note.textContent = v.errors[0];
  } else if (v.warnings.length) {
    note.className = 'row-note warn';
    note.textContent = v.warnings[0];
  } else {
    const h = row.desc.trim().length > 3 ? priceHistory(row.desc, state.items) : null;
    if (h && h.soldMedian) {
      const days = h.daysMedian != null ? `, took <b>${int(Math.round(h.daysMedian))} days</b>` : '';
      note.className = 'row-note hint';
      note.innerHTML = `${h.basis === 'similar items' ? 'Similar' : 'Your ' + h.basis} sold for <b>${money(h.soldMedian)}</b>${days} <span class="hint">(${int(h.n)})</span>`;
    } else {
      note.className = 'row-note';
      note.textContent = '';
    }
  }

  const nets = el.querySelector('.stock-nets');
  if (row.askCents > 0) {
    const m = margin(row.askCents, row.costCents || 0, rate);
    nets.classList.toggle('loss', m.profit < 0);
    nets.innerHTML = `<b>${money(m.net)}</b><br>${m.profit >= 0 ? '+' : ''}${money(m.profit)}`;
  } else {
    nets.classList.remove('loss');
    nets.textContent = '';
  }
}

function refreshAllRows() {
  state.stockTaken = takenNumbers(state.items);
  state.addStock.rows.forEach((_, i) => refreshRow(i));
}

function refreshTotals() {
  const as = state.addStock;
  const rate = stockCommission();
  const t = draftTotals(as.rows, rate);
  const counts = draftNumberCounts(as.rows);
  const bad = as.rows.filter((r) => !isRowEmpty(r) &&
    !validateRow(r, { taken: state.stockTaken, draftCounts: counts, commissionRate: rate }).ok).length;

  $('#as-totals').innerHTML = t.rows
    ? `<b>${int(t.items)}</b> item${t.items === 1 ? '' : 's'} · cost <b>${money(t.cost)}</b> · asking <b>${money(t.ask)}</b> · you keep <b>${money(t.net)}</b>`
      + (bad ? ` · <span style="color:var(--red)">${int(bad)} need${bad === 1 ? 's' : ''} fixing</span>` : '')
    : 'Nothing to add yet.';

  const btn = $('#as-submit');
  btn.disabled = as.busy || !t.rows || bad > 0;
  btn.textContent = as.busy ? 'Adding…' : t.rows ? `Add ${int(t.items)} item${t.items === 1 ? '' : 's'}` : 'Add items';
  $('#add-stock-sub').textContent = state.items.length
    ? `Numbers continue your ${nextDraftNumber()} series. Enter moves down, and adds a row at the bottom.`
    : 'Fetch your data first so Roost can pick inventory numbers for you.';
}

/* --- actions ------------------------------------------------------------- */

function splitLot() {
  const as = state.addStock;
  const rows = as.rows.filter((r) => !isRowEmpty(r));
  if (!as.lotCents || !rows.length) {
    banner('Enter what the lot cost, and at least one item to spread it over.', 'error');
    return;
  }
  const parts = splitLotCost(as.lotCents, rows);
  rows.forEach((r, i) => { r.costCents = parts[i]; });
  const weighted = rows.every((r) => r.askCents > 0);
  renderAddStock();
  banner(
    `Split ${money(as.lotCents)} across ${int(rows.length)} items, ${weighted ? 'weighted by asking price' : 'evenly'}.`,
    'ok'
  );
  setTimeout(() => banner(''), 3000);
  queueDraftSave();
}

async function submitStock() {
  const as = state.addStock;
  const rows = as.rows.filter((r) => !isRowEmpty(r));
  if (!rows.length) return;

  const acquired = Math.floor(new Date(`${as.acquired}T12:00:00`).getTime() / 1000);
  as.busy = true;
  refreshTotals();
  try {
    const res = await send('createItems', {
      rows: rows.map((r) => ({ item: buildCreatePayload(r, { acquired }), quantity: Math.max(1, r.qty || 1) }))
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'The create request failed.');

    const failed = res.results.filter((r) => !r.ok);
    if (res.items) {
      state.items = normalize(res.items);
      state.venueList = listVenues(state.items);
      rebuildLedger();
    }

    /* Only the rows that failed stay behind, already filled in, so a retry is
     * never a re-type. */
    as.rows = failed.length
      ? rows.filter((r) => failed.some((f) => f.inv === String(r.inv).trim()))
      : [];
    as.lotCents = null;
    saveDraft();

    banner(
      failed.length
        ? `Added ${int(res.created)}. ${failed.length} failed: ${failed[0].error}`
        : `Added ${int(res.created)} item${res.created === 1 ? '' : 's'} to Sandpiper.`,
      failed.length ? 'error' : 'ok'
    );
    if (!failed.length) { setTimeout(() => banner(''), 3200); closeAddStock(); }
    else renderAddStock();
    render();
  } catch (e) {
    banner(e.message, 'error');
  } finally {
    as.busy = false;
    if (as.open) refreshTotals();
  }
}

function initAddStock() {
  $('#add-stock-open').onclick = openAddStock;
  $('#add-stock-close').onclick = closeAddStock;
  $('#as-discard').onclick = () => {
    if (state.addStock.rows.some((r) => !isRowEmpty(r)) &&
        !confirm('Discard everything typed here?')) return;
    state.addStock.rows = [];
    state.addStock.lotCents = null;
    saveDraft();
    closeAddStock();
  };
  $('#as-submit').onclick = submitStock;
  $('#as-split').onclick = splitLot;
  $('#as-acquired').onchange = (e) => { state.addStock.acquired = e.target.value; queueDraftSave(); };
  $('#as-lot').oninput = (e) => { state.addStock.lotCents = centsFrom(e.target.value); };

  /* Keyed off what is actually on screen rather than what state believes: if
   * the two ever disagree again, Escape should still be a way out. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#add-stock').hidden) { closeAddStock(); return; }
    if (state.itemEditing) { state.itemEditing = null; renderItems(); }
  });
}

async function init() {
  if (new URLSearchParams(location.search).get('full') === '1') {
    document.body.classList.add('expanded');
    $('#expand').style.display = 'none';
  }
  initNav();
  renderPresets();

  $('#refresh').onclick = refresh;
  initAddStock();
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
  wireToggle('day-mode', 'dayMode', () => { if (state.quailStats) renderDailyChart(state.quailStats); });
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
  $('#item-add').onclick = openAddStock;
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
    /* A draft outlives the popup, which closes the moment you click away from
     * it — losing half a box of typing to a stray click would be unforgivable. */
    const pending = await loadDraft();
    const age = Date.now() - (cached.meta ? cached.meta.fetchedAt : 0);
    if (pending) {
      banner(`You have ${int(pending)} unsaved item${pending === 1 ? '' : 's'} in Add stock.`, 'info');
    } else if (age > 12 * 3600 * 1000) {
      banner('This data is over 12 hours old — fetch again for the latest.', 'info');
    }
  } else {
    showEmptyState();
    updateSubline();
    const session = await send('getSession');
    if (!session || !session.ok) banner((session && session.error) || 'Sign in to Sandpiper first.', 'error');
  }
}

init();
