import { useMemo, useState } from 'react';
import { useData } from '../store/data.jsx';
import { useNav } from '../store/nav.jsx';
import { analyze, UNASSIGNED } from '../lib/analytics.js';
import { rentForRange } from '../lib/ledger.js';
import { analyzeQuail } from '../lib/quail.js';
import { makeVenueLabels } from '../lib/venues.js';
import { PALETTE, SERIES_COLORS, lineChart, barChart, donut, hbar, scatter } from '../lib/charts.js';
import { money, int, pct, days, signClass, dayMonth } from '../lib/format.js';
import { format as fmtDate } from 'date-fns';
import { Card, CardHead, Kpi, Button } from '../components/ui.jsx';
import { Chart } from '../components/Chart.jsx';
import { Legend, DataTable, Trend, bandUp, bandDown, bandSign, nameCell } from '../components/analyze-ui.jsx';
import { SortableTable } from '../components/SortableTable.jsx';

const SPEED = [['0–7 d', 0, 7], ['8–30 d', 7, 30], ['31–60 d', 30, 60], ['61–90 d', 60, 90], ['91–180 d', 90, 180], ['180+ d', 180, Infinity]];
// Resolved at call time, never snapshotted — PALETTE is mutated in place by
// refreshPalette(), so a module-level array of its values would go stale.
const ageColor = (i) => [PALETTE.green, PALETTE.teal, PALETTE.blue, PALETTE.purple, PALETTE.brass, PALETTE.red][i];

export function Analyze({ tab }) {
  const { ledger, quailSales, raw, venueInfo, venueNames } = useData();
  const { range, venue } = useNav();

  const scopedRent = useMemo(() => {
    const rows = (raw.quail && raw.quail.rent) || [];
    if (venue.kind !== 'booth' || !venue.id) return rows;
    const info = venueInfo.booths && venueInfo.booths[venue.id];
    const ext = info && info.externalId != null ? info.externalId : null;
    return ext == null ? rows : rows.filter((r) => r.boothId === ext);
  }, [raw.quail, venue, venueInfo]);

  const s = useMemo(
    () => analyze(ledger, { start: range.start, end: range.end }, venue.kind === 'all' ? null : venue),
    [ledger, range, venue]
  );
  const rentInfo = useMemo(() => rentForRange(scopedRent, range.start, range.end), [scopedRent, range]);

  const scopedQuail = useMemo(() => {
    if (venue.kind !== 'booth' || !venue.id) return quailSales;
    const info = venueInfo.booths && venueInfo.booths[venue.id];
    const ext = info && info.externalId != null ? info.externalId : null;
    return ext == null ? quailSales : quailSales.filter((x) => x.boothId === ext);
  }, [quailSales, venue, venueInfo]);

  const q = useMemo(
    () => (scopedQuail.length ? analyzeQuail(scopedQuail, { start: range.start, end: range.end, rentCents: rentInfo.cents }) : null),
    [scopedQuail, range, rentInfo]
  );

  const vl = useMemo(() => makeVenueLabels(venueInfo, venueNames), [venueInfo, venueNames]);
  const ctx = { s, q, rentInfo, range, venue, ledger, scopedRent, vl };

  if (tab === 'sales') return <SalesTab {...ctx} />;
  if (tab === 'inventory') return <InventoryTab {...ctx} />;
  if (tab === 'catalog') return <CatalogTab {...ctx} />;
  if (tab === 'venues') return <VenuesTab {...ctx} />;
  return <Overview {...ctx} />;
}

/* ------------------------------------------------------------------ Overview */

function Overview({ s, q, rentInfo, range, ledger, scopedRent, venue }) {
  const [flowMode, setFlowMode] = useState('money');
  const prev = s.previous || { hasData: false };
  const grossProfit = s.sales.profit;
  const netProfit = grossProfit - rentInfo.cents;
  const takeHome = s.sales.net - rentInfo.cents;
  // Rent is a booth cost, so measure it against booth-channel profit only —
  // direct-channel (Facebook) profit shouldn't paper over the booth's rent.
  const boothProfit = (s.sales.booth && s.sales.booth.profit != null) ? s.sales.booth.profit : grossProfit;
  const rentCover = rentInfo.cents > 0 ? boothProfit / rentInfo.cents : null;
  const netMargin = s.sales.gross > 0 ? netProfit / s.sales.gross : null;
  const staleShare = s.inventory.units ? s.inventory.stale / s.inventory.units : 0;
  const sub = (text, cur, pr) => <>{text} <Trend current={cur} prior={pr} hasData={prev.hasData} /></>;

  const labels = s.buckets.map((b) => b.label);

  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Gross sales" value={money(s.sales.gross, { compact: true })} exact={money(s.sales.gross)} sub={sub(`${s.counts.sold} sales`, s.sales.gross, prev.gross)} />
        <Kpi label="Net payout" value={money(s.sales.net, { compact: true })} exact={money(s.sales.net)} sub={sub(`less ${money(s.sales.commissions, { compact: true })} commission`, s.sales.net, prev.net)} />
        <Kpi label="Take-home" hero status={bandSign(takeHome)} value={money(takeHome, { compact: true })} exact={money(takeHome)} sub={`less rent ${money(rentInfo.cents, { compact: true })}`} />
        <Kpi label="Net profit" hero status={bandSign(netProfit)} value={money(netProfit, { compact: true })} exact={money(netProfit)} sub={`less ${money(s.sales.cogs, { compact: true })} cost of goods${netMargin == null ? '' : ` · ${pct(netMargin)} margin`}`} />
        <Kpi label="Stock at cost" value={money(s.inventory.cost, { compact: true })} exact={money(s.inventory.cost)} sub={`${s.inventory.units} items unsold`} />
        <Kpi label="Asking value" value={money(s.inventory.ask, { compact: true })} exact={money(s.inventory.ask)} sub="what that stock is priced at" />
        <Kpi label="Potential profit" status={s.inventory.units ? bandSign(s.inventory.potentialProfit) : null} value={money(s.inventory.potentialProfit, { compact: true })} exact={money(s.inventory.potentialProfit)} sub="if it all sells at asking" />
        <Kpi label="Spent on stock" value={money(s.buying.spend, { compact: true })} exact={money(s.buying.spend)} sub={sub(`${s.buying.units} items`, s.buying.spend, prev.spend)} />
        <Kpi label="Rent covered" status={bandUp(rentCover, 1, 0.6)} value={pct(rentCover, 0)} sub="booth profit against booth rent" />
        <Kpi label="Sell-through" status={s.counts.sold + s.counts.onHand ? bandUp(s.velocity.sellThrough, 0.4, 0.2) : null} value={pct(s.velocity.sellThrough)} sub={`${int(s.counts.sold)} of ${int(s.counts.sold + s.counts.onHand)} available`} />
        <Kpi label="Aged over 180 days" status={s.inventory.units ? bandDown(staleShare, 0.001, 0.2) : null} value={int(s.inventory.stale)} sub={s.inventory.stale ? `${money(s.inventory.staleCost, { compact: true })} tied up` : 'nothing sitting long'} />
        <Kpi label="Since last sale" status={q ? bandDown(q.daysSinceLastSale, 7, 21) : null} value={q && q.daysSinceLastSale != null ? days(q.daysSinceLastSale) : '—'} sub={q && q.lastSaleAt ? dayMonth(q.lastSaleAt) : 'from the register'} />
      </div>

      <DailyCard q={q} />

      <Card>
        <CardHead title="Cumulative profit" hint="Running totals across the range" />
        <CumulativeChart s={s} scopedRent={scopedRent} end={range.end} />
      </Card>

      <div className="grid-2">
        <Card><CardHead title="Net payout vs. cost of goods" />
          <FlowlikeBar labels={labels} series={[
            { name: 'Net payout', color: PALETTE.blue, values: s.buckets.map((b) => b.net) },
            { name: 'Cost of goods', color: PALETTE.purple, values: s.buckets.map((b) => b.cogs) }]} height={168} /></Card>
        <Card><CardHead title="Where the money sits" hint="At cost" />
          <Chart deps={[s]} draw={(el) => donut(el, {
            height: 158, centerValue: money(s.inventory.cost + s.sales.cogs, { compact: true }), centerLabel: 'total cost',
            segments: [
              { label: 'Unsold inventory', value: s.inventory.cost, color: PALETTE.brass },
              { label: 'Sold (recovered)', value: s.sales.cogs, color: PALETTE.green }]
          })} /></Card>
      </div>

      <Card>
        <CardHead title="Buying vs. selling">
          <Toggle value={flowMode} onChange={setFlowMode} />
        </CardHead>
        <FlowChart s={s} asMoney={flowMode === 'money'} />
      </Card>

      <div className="grid-2">
        <DowCard q={q} />
        <HourCard q={q} />
      </div>
    </>
  );
}

function CumulativeChart({ s, scopedRent, end }) {
  const labels = s.buckets.map((b) => b.label);
  let rentSoFar = 0;
  const cumNet = s.buckets.map((b, i) => { rentSoFar += rentForRange(scopedRent, b.t, Math.min(b.next - 1, end)).cents; return s.cumulative[i].profit - rentSoFar; });
  const series = [
    { name: 'Net payout', color: PALETTE.blue, values: s.cumulative.map((b) => b.net) },
    { name: 'Gross profit', color: PALETTE.green, values: s.cumulative.map((b) => b.profit) }
  ];
  if (rentSoFar > 0) series.push({ name: 'Net profit, after rent', color: PALETTE.brass, values: cumNet });
  return (<><Chart deps={[s, scopedRent]} draw={(el) => lineChart(el, { labels, series, height: 180 })} /><Legend series={series} /></>);
}

function FlowlikeBar({ labels, series, height }) {
  return (<><Chart deps={[series, labels]} draw={(el) => barChart(el, { labels, series, height })} /><Legend series={series} /></>);
}

function FlowChart({ s, asMoney }) {
  const labels = s.buckets.map((b) => b.label);
  const acq = s.buckets.map((b) => b.acquired);
  const soldU = s.buckets.map((b) => b.units);
  const series = asMoney
    ? [{ name: 'Spent on stock', color: PALETTE.purple, values: s.buckets.map((b) => b.spend), alt: acq.map((n) => `${int(n)} items`) },
       { name: 'Net payout', color: PALETTE.green, values: s.buckets.map((b) => b.net), alt: soldU.map((n) => `${int(n)} items`) }]
    : [{ name: 'Acquired', color: PALETTE.purple, values: acq, alt: s.buckets.map((b) => money(b.spend, { compact: true })) },
       { name: 'Sold', color: PALETTE.green, values: soldU, alt: s.buckets.map((b) => money(b.net, { compact: true })) }];
  return (<>
    <Chart deps={[s, asMoney]} draw={(el) => barChart(el, {
      labels, series, height: 168, integerY: !asMoney,
      yFormat: asMoney ? (v) => money(v, { compact: true }) : (v) => int(v),
      tipFormat: (v, ser, i) => `${asMoney ? money(v) : `${int(v)} items`}${ser.alt ? ` · ${ser.alt[i]}` : ''}`
    })} />
    <Legend series={series} />
  </>);
}

function Toggle({ value, onChange }) {
  return (
    <div className="toggle">
      <button className={value === 'money' ? 'active' : ''} onClick={() => onChange('money')}>$</button>
      <button className={value === 'units' ? 'active' : ''} onClick={() => onChange('units')}>Units</button>
    </div>
  );
}

function DailyCard({ q }) {
  const [mode, setMode] = useState('money');
  const asMoney = mode === 'money';
  return (
    <Card>
      <CardHead title="Sales by day" hint="Register times, including days with no sales">
        <Toggle value={mode} onChange={setMode} />
      </CardHead>
      {!q ? <div className="chart-empty">No register data</div> : (<>
        <Chart deps={[q, mode]} draw={(el) => barChart(el, {
          labels: q.days.map((d) => d.label), height: 180, integerY: !asMoney,
          series: [{ name: asMoney ? 'Gross sales' : 'Items sold', color: PALETTE.blue, values: q.days.map((d) => (asMoney ? d.gross : d.units)) }],
          yFormat: asMoney ? (v) => money(v, { compact: true }) : (v) => int(v),
          tipFormat: (v, ser, i) => (asMoney ? `${money(q.days[i].gross)} · ${int(q.days[i].units)} items` : `${int(q.days[i].units)} items · ${money(q.days[i].gross)}`)
        })} />
        <Legend series={[{ name: asMoney ? 'Gross sales' : 'Items sold', color: PALETTE.blue }]} />
      </>)}
    </Card>
  );
}

function DowCard({ q }) {
  const [mode, setMode] = useState('money');
  const asMoney = mode === 'money';
  return (
    <Card>
      <CardHead title="By day of the week" hint="Averaged per occurrence">
        <Toggle value={mode} onChange={setMode} />
      </CardHead>
      {!q ? <div className="chart-empty">No register data</div> : (
        <Chart deps={[q, mode]} draw={(el) => barChart(el, {
          labels: q.dayOfWeek.map((d) => d.label), height: 170,
          series: [{ name: asMoney ? 'Avg takings' : 'Avg items', color: PALETTE.brass, values: q.dayOfWeek.map((d) => (asMoney ? d.avgGross : d.avgUnits)) }],
          yFormat: asMoney ? (v) => money(v, { compact: true }) : (v) => (v >= 10 ? int(v) : v.toFixed(1)),
          tipFormat: (v, ser, i) => {
            const d = q.dayOfWeek[i]; const each = `over ${d.occurrences} × ${d.label}`;
            return asMoney ? `${money(d.avgGross)} avg · ${d.avgUnits.toFixed(1)} items avg ${each}` : `${d.avgUnits.toFixed(1)} items avg · ${money(d.avgGross)} avg ${each}`;
          }
        })} />
      )}
    </Card>
  );
}

function HourCard({ q }) {
  const [mode, setMode] = useState('units');
  const asMoney = mode === 'money';
  const win = (() => {
    if (!q) return [];
    const active = q.hours.filter((h) => h.units > 0);
    const lo = active.length ? Math.max(0, active[0].hour - 1) : 8;
    const hi = active.length ? Math.min(23, active[active.length - 1].hour + 1) : 20;
    return q.hours.slice(lo, hi + 1);
  })();
  return (
    <Card>
      <CardHead title="By hour" hint="Clock times that saw trade">
        <Toggle value={mode} onChange={setMode} />
      </CardHead>
      {!q ? <div className="chart-empty">No register data</div> : (
        <Chart deps={[q, mode]} draw={(el) => barChart(el, {
          labels: win.map((h) => h.label), height: 170, integerY: !asMoney,
          series: [{ name: asMoney ? 'Gross sales' : 'Items', color: PALETTE.purple, values: win.map((h) => (asMoney ? h.gross : h.units)) }],
          yFormat: asMoney ? (v) => money(v, { compact: true }) : (v) => int(v),
          tipFormat: (v, ser, i) => (asMoney ? `${money(win[i].gross)} · ${int(win[i].units)} items` : `${int(win[i].units)} items · ${money(win[i].gross)}`)
        })} />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ Sales */

function SalesTab({ s }) {
  const prev = s.previous || { hasData: false };
  const profitCols = [
    { title: 'Item', cls: 'name', render: nameCell },
    { title: 'Cost', num: true, render: (r) => money(r.cost, { compact: true }) },
    { title: 'Sold', num: true, render: (r) => money(r.soldPrice, { compact: true }) },
    { title: 'Profit', num: true, cls: (r) => signClass(r.profit), render: (r) => money(r.profit, { compact: true }) },
    { title: 'Days', num: true, render: (r) => days(r.daysToSell) }
  ];
  const speedRows = SPEED.map(([label, lo, hi]) => {
    const g = s.sales_rows.filter((i) => i.daysToSell != null && i.daysToSell >= lo && i.daysToSell < hi);
    return { label, value: g.length, sub: `${g.length} items · ${money(g.reduce((a, i) => a + i.profit, 0))} profit` };
  });
  return (<>
    <div className="kpi-grid">
      <Kpi label="Gross sales" value={money(s.sales.gross, { compact: true })} exact={money(s.sales.gross)} sub={<>{s.counts.sold} sales <Trend current={s.sales.gross} prior={prev.gross} hasData={prev.hasData} /></>} />
      <Kpi label="Commission" value={money(s.sales.commissions, { compact: true })} exact={money(s.sales.commissions)} sub={`${pct(s.inventory.commissionRate, 1)} of gross sales`} />
      <Kpi label="Cost of goods" value={money(s.sales.cogs, { compact: true })} exact={money(s.sales.cogs)} sub={`avg ${money(s.counts.sold ? s.sales.cogs / s.counts.sold : 0, { compact: true })} per item`} />
      <Kpi label="Gross profit" hero status={bandSign(s.sales.profit)} value={money(s.sales.profit, { compact: true })} exact={money(s.sales.profit)} sub={<>{money(s.sales.avgProfit, { compact: true })} per item <Trend current={s.sales.profit} prior={prev.profit} hasData={prev.hasData} /></>} />
      <Kpi label="Margin" status={s.counts.sold ? bandUp(s.sales.margin, 0.4, 0.2) : null} value={pct(s.sales.margin)} sub="gross profit as a share of sales" />
      <Kpi label="Return on cost" status={s.counts.sold ? bandUp(s.sales.roi, 1, 0.4) : null} value={pct(s.sales.roi)} sub="gross profit per $1 of stock" />
      <Kpi label="Avg sale price" value={money(s.sales.avgSale, { compact: true })} exact={money(s.sales.avgSale)} sub={`best period ${s.sales.bestMonth ? s.sales.bestMonth.label : '—'}`} />
      <Kpi label="Avg discount" status={s.counts.sold ? bandDown(s.sales.discountRate, 0.05, 0.15) : null} value={pct(s.sales.discountRate)} sub={`${pct(s.sales.fullPriceRate)} sold at full asking`} />
    </div>
    <Card><CardHead title="Gross profit by period" />
      <Chart deps={[s]} draw={(el) => barChart(el, { labels: s.buckets.map((b) => b.label), height: 180, series: [{ name: 'Gross profit', color: PALETTE.green, values: s.buckets.map((b) => b.profit) }] })} /></Card>
    <div className="grid-2">
      <Card><CardHead title="Cost vs. sold price" /><Chart deps={[s]} draw={(el) => scatter(el, { points: s.scatter, height: 190 })} /></Card>
      <Card><CardHead title="Time to sell" /><Chart deps={[s]} draw={(el) => hbar(el, { rows: speedRows, format: (v) => `${int(v)} sold`, colorFor: (_, i) => ageColor(i) })} /></Card>
    </div>
    <div className="grid-2">
      <Card><CardHead title="Top profit" /><DataTable rows={s.lists.topProfit} columns={profitCols} empty="No sales in this range" /></Card>
      <Card><CardHead title="Biggest losses" /><DataTable rows={s.lists.worstProfit} columns={profitCols} empty="No losses in this range — nice." /></Card>
    </div>
  </>);
}

/* --------------------------------------------------------------- Inventory */

function InventoryTab({ s }) {
  const staleShare = s.inventory.units ? s.inventory.stale / s.inventory.units : 0;
  return (<>
    <div className="kpi-grid">
      <Kpi label="Items unsold" status={s.counts.unpriced ? 'watch' : null} value={int(s.inventory.units)} sub={`${s.counts.unpriced} items without an asking price`} />
      <Kpi label="Stock at cost" value={money(s.inventory.cost, { compact: true })} exact={money(s.inventory.cost)} sub={`avg ${money(s.inventory.units ? s.inventory.cost / s.inventory.units : 0, { compact: true })} per item`} />
      <Kpi label="Asking value" value={money(s.inventory.ask, { compact: true })} exact={money(s.inventory.ask)} sub={`${money(s.inventory.potentialNet, { compact: true })} after commission`} />
      <Kpi label="Potential profit" hero={s.inventory.units > 0} status={s.inventory.units ? bandSign(s.inventory.potentialProfit) : null} value={money(s.inventory.potentialProfit, { compact: true })} exact={money(s.inventory.potentialProfit)} sub="if it all sells at asking" />
      <Kpi label="Median age" status={bandDown(s.inventory.medianAge, 90, 180)} value={days(s.inventory.medianAge)} sub={`avg ${days(s.inventory.avgAge)}`} />
      <Kpi label="Aged over 180 days" status={s.inventory.units ? bandDown(staleShare, 0.001, 0.2) : null} value={int(s.inventory.stale)} sub={s.inventory.stale ? `${money(s.inventory.staleCost, { compact: true })} tied up` : 'nothing sitting long'} />
      <Kpi label="Stock turns" status={bandUp(s.velocity.turns, 1, 0.3)} value={`${s.velocity.turns.toFixed(2)}×`} sub="cost of goods ÷ stock at cost" />
      <Kpi label="Days of supply" status={bandDown(s.velocity.daysOfSupply, 120, 365)} value={s.velocity.daysOfSupply ? days(s.velocity.daysOfSupply) : '—'} sub="at the current sales pace" />
    </div>
    <div className="grid-2">
      <Card><CardHead title="Stock aging" hint="Stock at cost by age" />
        <Chart deps={[s]} draw={(el) => hbar(el, { rows: s.aging.map((a) => ({ label: a.label, value: a.cost, sub: `${a.count} items · ${money(a.ask)} ask` })), format: (v) => money(v, { compact: true }), colorFor: (_, i) => ageColor(i) })} /></Card>
      <Card><CardHead title="Asking-price bands" hint="Items unsold" />
        <Chart deps={[s]} draw={(el) => barChart(el, { labels: s.bands.map((b) => b.label), height: 170, integerY: true, yFormat: (v) => int(v), tipFormat: (v) => `${int(v)} items`, series: [{ name: 'On hand', color: PALETTE.brass, values: s.bands.map((b) => b.count) }, { name: 'Sold in range', color: PALETTE.green, values: s.bands.map((b) => b.sold) }] })} /></Card>
    </div>
    <div className="grid-2">
      <Card><CardHead title="Oldest unsold items" />
        <DataTable rows={s.lists.slowMovers} empty="No unsold inventory" columns={[
          { title: 'Item', cls: 'name', render: nameCell },
          { title: 'Age', num: true, cls: (r) => (r.age > 180 ? 'neg' : ''), render: (r) => days(r.age) },
          { title: 'Cost', num: true, render: (r) => money(r.cost, { compact: true }) },
          { title: 'Ask', num: true, render: (r) => (r.ask ? money(r.ask, { compact: true }) : <span className="pill">unpriced</span>) }]} /></Card>
      <Card><CardHead title="Biggest bets" hint="Unsold, by cost" />
        <DataTable rows={s.lists.biggestBets} empty="No unsold inventory" columns={[
          { title: 'Item', cls: 'name', render: nameCell },
          { title: 'Cost', num: true, render: (r) => money(r.cost, { compact: true }) },
          { title: 'Ask', num: true, render: (r) => money(r.ask, { compact: true }) },
          { title: 'Markup', num: true, render: (r) => (r.markup ? `${r.markup.toFixed(1)}×` : '—') }]} /></Card>
    </div>
  </>);
}

/* ----------------------------------------------------------------- Catalog */

function CatalogTab({ s }) {
  const cats = s.categories.slice(0, 9);
  return (<>
    <div className="grid-2">
      <Card><CardHead title="Profit by category" />
        <Chart deps={[s]} draw={(el) => hbar(el, { rows: cats.map((c) => ({ label: c.name, value: c.profit, sub: `${c.sold} sold` })), format: (v) => money(v, { compact: true }), colorFor: (r) => (r.value >= 0 ? PALETTE.green : PALETTE.red) })} /></Card>
      <Card><CardHead title="Sell-through by category" />
        <Chart deps={[s]} draw={(el) => hbar(el, { rows: [...cats].sort((a, b) => b.sellThrough - a.sellThrough).map((c) => ({ label: c.name, value: c.sellThrough, sub: `${c.sold} of ${c.total}` })), format: (v) => pct(v, 0), colorFor: () => PALETTE.brass })} /></Card>
    </div>
    <Card><CardHead title="Categories" />
      <SortableTable rows={s.categories} empty="No categories" getKey={(r) => r.name}
        initialSort={{ key: 'profit', dir: -1 }} columns={[
          { key: 'name', title: 'Category', cls: 'name', render: (r) => r.name },
          { key: 'onHand', title: 'On hand', num: true, render: (r) => int(r.onHand) },
          { key: 'sold', title: 'Sold', num: true, render: (r) => int(r.sold) },
          { key: 'sellThrough', title: 'Sell-through', num: true, render: (r) => pct(r.sellThrough, 0) },
          { key: 'cost', title: 'Stock at cost', num: true, render: (r) => money(r.cost, { compact: true }) },
          { key: 'ask', title: 'Asking value', num: true, render: (r) => money(r.ask, { compact: true }) },
          { key: 'net', title: 'Net payout', num: true, render: (r) => money(r.net, { compact: true }) },
          { key: 'profit', title: 'Profit', num: true, cls: (r) => signClass(r.profit), render: (r) => money(r.profit, { compact: true }) }]} /></Card>
  </>);
}

/* ------------------------------------------------------------------ Venues */

const CHAN_TONE = { pos: '', direct: 'probable', unassigned: 'manual' };
const CHAN_TYPE_LABEL = { pos: 'Booth', direct: 'Direct', unassigned: 'Unassigned' };

function VenuesTab({ s, vl }) {
  const { stores, booths } = s.venues;
  const { renameVenue, venueInfo } = useData();
  const { openManageChannels, setVenue } = useNav();
  const chans = s.sales.channels || [];
  const totals = chans.reduce((a, c) => ({ units: a.units + c.units, gross: a.gross + c.gross, net: a.net + c.net, profit: a.profit + c.profit }), { units: 0, gross: 0, net: 0, profit: 0 });
  const scopeTo = (c) => {
    if (c.type === 'unassigned') return;
    setVenue(venueInfo.booths && venueInfo.booths[c.id] ? { kind: 'booth', id: c.id } : { kind: 'store', id: c.id });
  };
  const series = s.venues.boothSeries.map((b, i) => ({ name: vl.label(b.id, 'booth'), color: SERIES_COLORS[i % SERIES_COLORS.length], values: b.values }));
  return (<>
    <Card className="records-card-plain">
      <div className="card-head">
        <h2>Sales by channel</h2>
        <span className="hint source">Booth (POS) vs direct channels like Facebook</span>
        <Button small onClick={openManageChannels}>Manage channels</Button>
      </div>
      {chans.length === 0 ? <div className="note">No sales in this range.</div> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Channel</th><th>Type</th><th className="num">Units</th><th className="num">Gross</th><th className="num">Net payout</th><th className="num">Profit</th></tr></thead>
            <tbody>
              {chans.map((c) => (
                <tr key={c.id} className="editable" onClick={() => scopeTo(c)} title={c.type === 'unassigned' ? '' : 'View this channel'}>
                  <td className="name">{c.label}</td>
                  <td><span className={`pill ${CHAN_TONE[c.type] || ''}`}>{CHAN_TYPE_LABEL[c.type] || c.type}</span></td>
                  <td className="num">{int(c.units)}</td>
                  <td className="num">{money(c.gross, { compact: true })}</td>
                  <td className="num">{money(c.net, { compact: true })}</td>
                  <td className={`num ${signClass(c.profit)}`}>{money(c.profit, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td>All channels</td><td />
              <td className="num">{int(totals.units)}</td>
              <td className="num">{money(totals.gross, { compact: true })}</td>
              <td className="num">{money(totals.net, { compact: true })}</td>
              <td className={`num ${signClass(totals.profit)}`}>{money(totals.profit, { compact: true })}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </Card>
    <div className="grid-2">
      <Card><CardHead title="Net payout by booth" />
        <Chart deps={[s]} draw={(el) => hbar(el, { rows: booths.map((b) => ({ label: vl.label(b.id, 'booth'), value: b.net, sub: `${b.units} sold · ${money(b.profit)} gross profit` })), format: (v) => money(v, { compact: true }), colorFor: (r, i) => (r.value < 0 ? PALETTE.red : SERIES_COLORS[i % SERIES_COLORS.length]) })} /></Card>
      <Card><CardHead title="Share by store" />
        <Chart deps={[s]} draw={(el) => donut(el, { height: 158, centerValue: money(stores.reduce((a, v) => a + v.net, 0), { compact: true }), centerLabel: 'net payout', segments: stores.map((v) => ({ label: vl.label(v.id, 'store'), value: Math.max(0, v.net) })), format: (v) => money(v, { compact: true }) })} /></Card>
    </div>
    <Card><CardHead title="Booths over time" />
      <Chart deps={[s]} draw={(el) => barChart(el, { labels: s.buckets.map((b) => b.label), series, height: 176, stacked: series.length > 1 })} />
      <Legend series={series} /></Card>
    <Card><CardHead title="Booths" />
      <VenueTable rows={booths} kind="booth" vl={vl} rename={renameVenue} /></Card>
    <Card><CardHead title="Stores" />
      <VenueTable rows={stores} kind="store" vl={vl} rename={renameVenue} /></Card>
  </>);
}

function VenueNameInput({ id, initial, disabled, rename }) {
  const [name, setName] = useState(initial);
  return <input className="name-input" data-venue={id} value={name} disabled={disabled}
    onChange={(e) => setName(e.target.value)} onBlur={() => rename(id, name)}
    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />;
}

function VenueTable({ rows, kind, vl, rename }) {
  if (!rows.length) return <div className="empty-row">No sales with a venue in this range</div>;
  return (
    <table>
      <thead><tr>
        <th>{kind === 'store' ? 'Store' : 'Booth'}</th>
        <th>{kind === 'store' ? 'Location' : 'Store'}</th>
        <th className="num">Sold</th><th className="num">Gross sales</th><th className="num">Commission</th>
        {kind === 'booth' && <th className="num">Rate (agreed)</th>}
        <th className="num">Net payout</th><th className="num">Profit</th><th className="num">Margin</th>
        <th className="num">Avg sale</th><th className="num">Median days</th><th className="num">Share</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => {
          const info = vl.info(r.id, 'booth');
          const agreed = info && info.consignmentRate != null ? info.consignmentRate : null;
          const off = agreed != null && r.commissionRate != null && Math.abs(agreed - r.commissionRate) > 0.005;
          return (
            <tr key={r.id}>
              <td><VenueNameInput id={r.id} initial={vl.label(r.id, kind)} disabled={r.id === UNASSIGNED} rename={rename} /></td>
              <td className={kind === 'booth' ? 'name' : ''}>{kind === 'store' ? vl.location(r.id) : vl.label(vl.boothStore(r), 'store')}</td>
              <td className="num">{int(r.units)}</td>
              <td className="num">{money(r.gross, { compact: true })}</td>
              <td className="num">{money(-r.commissions, { compact: true })}</td>
              {kind === 'booth' && <td className="num">{pct(r.commissionRate, 1)}{agreed != null && <span className={off ? 'neg' : 'muted-inline'}> ({pct(agreed, 1)})</span>}</td>}
              <td className="num">{money(r.net, { compact: true })}</td>
              <td className={`num ${signClass(r.profit)}`}>{money(r.profit, { compact: true })}</td>
              <td className="num">{pct(r.margin, 0)}</td>
              <td className="num">{money(r.avgSale, { compact: true })}</td>
              <td className="num">{days(r.medianDays)}</td>
              <td className="num">{pct(r.share, 0)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
