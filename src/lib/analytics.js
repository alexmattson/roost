/* Roost — data normalisation + metric derivation.
 * All money is kept in cents until it is formatted for display. */

export const DAY = 86400000;

// Keywords are matched whole-word and tolerate simple plurals ("sconce" -> "sconces").
const rule = (name, words) => [name, new RegExp(`\\b(?:${words.join('|')})(?:s|es)?\\b`, 'i')];

/* Order matters: the first matching rule wins, so specific form/function buckets
 * come before material-based ones (a "brass lamp" should read as Lighting, not
 * Metalware) and before the broad container/storage bucket. Keywords are chosen
 * to be whole-word safe — bare words that collide with other buckets (a lone
 * "pin", "ring", "art", "top") are avoided in favour of unambiguous phrases. */
const CATEGORY_RULES = [
  rule('Clocks & Timepieces', ['clock', 'wristwatch', 'pocket watch', 'watch', 'timepiece', 'sundial',
    'hourglass', 'cuckoo', 'grandfather clock', 'mantel clock', 'carriage clock', 'anniversary clock']),
  rule('Lighting', ['lamp', 'lantern', 'sconce', 'candelabra', 'candelabrum', 'candlestick', 'candle holder',
    'candleholder', 'candle', 'chandelier', 'pendant light', 'torchiere', 'torchère', 'oil lamp', 'hurricane lamp',
    'gas lamp', 'floor lamp', 'table lamp', 'desk lamp', 'wall light', 'night light', 'lampshade', 'lightbulb']),
  rule('Furniture', ['chair', 'armchair', 'table(?! tennis)', 'stool', 'bench', 'dresser', 'hutch', 'cabinet',
    'cupboard', 'chest', 'shelf', 'shelves', 'bookcase', 'bookshelf', 'bed', 'headboard', 'footboard', 'ottoman',
    'trunk', 'desk', 'rocker', 'rocking chair', 'drawer', 'secretary', 'sideboard', 'armoire', 'wardrobe', 'vanity',
    'credenza', 'buffet', 'settee', 'sofa', 'couch', 'loveseat', 'nightstand', 'washstand', 'plant stand', 'pew',
    'étagère', 'etagere', 'commode', 'chiffonier', 'highboy', 'lowboy', 'coat rack', 'hall tree', 'bar cart',
    'footstool', 'step stool']),
  rule('Musical Instruments', ['guitar', 'violin', 'fiddle', 'banjo', 'mandolin', 'ukulele', 'piano', 'organ',
    'accordion', 'harmonica', 'trumpet', 'trombone', 'saxophone', 'clarinet', 'flute', 'drum', 'tambourine', 'harp',
    'cello', 'bugle', 'concertina', 'phonograph', 'gramophone', 'victrola', 'record', 'vinyl', 'music box',
    'metronome', 'sheet music']),
  rule('Cameras & Electronics', ['camera', 'lens', 'radio', 'television', 'telephone', 'typewriter', 'projector',
    'stereoscope', 'viewfinder', 'record player', 'turntable', 'microphone', 'transistor', 'adding machine',
    'telegraph', 'calculator']),
  rule('Books & Paper', ['book', 'bible', 'atlas', 'ledger', 'journal', 'diary', 'postcard', 'photograph', 'photo',
    'ephemera', 'magazine', 'newspaper', 'almanac', 'dictionary', 'encyclopedia', 'manuscript', 'pamphlet', 'map',
    'blueprint', 'certificate', 'comic', 'hymnal', 'scrapbook', 'stereoview', 'catalog']),
  rule('Art & Wall Decor', ['painting', 'portrait', 'artwork', 'wall art', 'folk art', 'print', 'lithograph',
    'etching', 'engraving', 'woodcut', 'watercolor', 'watercolour', 'oil painting', 'frame', 'framed', 'landscape',
    'embroidery', 'needlepoint', 'sampler', 'mirror', 'still life', 'canvas', 'drawing', 'sketch', 'poster',
    'plaque', 'wall hanging', 'silhouette', 'tintype', 'daguerreotype']),
  rule('Rugs & Textiles', ['rug', 'runner', 'quilt', 'pillow', 'pillowcase', 'cushion', 'blanket', 'poncho',
    'textile', 'cowhide', 'linen', 'tapestry', 'throw', 'doily', 'tablecloth', 'table linen', 'curtain', 'drape',
    'drapery', 'shawl', 'kilim', 'dhurrie', 'needlework', 'coverlet', 'bedspread', 'afghan', 'lace', 'tea towel',
    'feed sack', 'flour sack', 'flag', 'sewing machine', 'sewing', 'spinning wheel', 'loom', 'spool', 'thimble',
    'yarn']),
  rule('Baskets & Wicker', ['basket', 'wicker', 'rattan', 'hamper', 'bushel', 'creel', 'trug']),
  rule('Pottery & Ceramics', ['pottery', 'ceramic', 'stoneware', 'porcelain', 'crock', 'vase', 'vessel', 'jug',
    'pitcher', 'mug', 'bowl', 'planter', 'terracotta', 'terra cotta', 'jar', 'teapot', 'cachepot', 'creamer',
    'sugar bowl', 'dish', 'platter', 'saucer', 'teacup', 'tureen', 'urn', 'ewer', 'chamber pot', 'majolica',
    'delft', 'ironstone', 'redware', 'earthenware', 'figurine', 'amphora', 'demijohn', 'pot', 'crockery',
    'ramekin', 'compote', 'jardiniere']),
  rule('Glassware', ['glassware', 'crystal', 'depression glass', 'milk glass', 'carnival glass', 'stained glass',
    'cut glass', 'pressed glass', 'decanter', 'tumbler', 'stemware', 'goblet', 'snifter', 'paperweight',
    'apothecary', 'bottle', 'flask', 'vial', 'perfume bottle', 'atomizer', 'stein', 'glass']),
  rule('Kitchen & Barware', ['rolling pin', 'mold', 'mould', 'mortar', 'pestle', 'butter dish', 'butter', 'tray',
    'coaster', 'jigger', 'bottle opener', 'corkscrew', 'napkin', 'washboard', 'kettle', 'bellows', 'spoon', 'fork',
    'flatware', 'silverware', 'cutlery', 'utensil', 'grinder', 'coffee grinder', 'trivet', 'ashtray', 'canister',
    'colander', 'sieve', 'strainer', 'whisk', 'ladle', 'skillet', 'saucepan', 'frying pan', 'breadbox', 'cookie jar',
    'cocktail shaker', 'percolator', 'samovar', 'muddler', 'toaster', 'waffle iron', 'nutcracker', 'juicer', 'churn',
    'funnel', 'grater', 'scale']),
  rule('Jewelry & Accessories', ['jewelry', 'jewellery', 'necklace', 'bracelet', 'brooch', 'earring', 'locket',
    'cufflink', 'tiara', 'cameo', 'beads', 'choker', 'pocketbook', 'handbag', 'purse', 'wallet', 'hatpin', 'stickpin',
    'lapel pin', 'buckle', 'compact', 'pillbox', 'parasol', 'umbrella', 'gloves', 'bonnet']),
  rule('Sporting & Games', ['tennis', 'baseball', 'basketball', 'football', 'badminton', 'croquet', 'snow ?shoe',
    'pinball', 'board game', 'game', 'racket', 'baseball bat', 'paddle', 'decoy', 'sled', 'sledge', 'toboggan',
    'fishing rod', 'fishing', 'reel', 'tackle', 'skis', 'ski', 'golf', 'dominoes', 'chess', 'checkers', 'dice', 'playing cards',
    'dartboard', 'dart', 'trophy', 'hunting', 'trap', 'oar', 'canoe', 'kayak', 'skate', 'horseshoe', 'bowling',
    'billiard', 'pool cue']),
  rule('Toys & Children', ['doll', 'toy', 'ride-on', 'clown', 'piggy bank', 'piggybank', 'rocking horse', 'teddy',
    'marionette', 'puppet', 'jack-in-the-box', 'yo-yo', 'cradle', 'pram', 'stroller', 'building block',
    'alphabet block', 'kaleidoscope', 'spinning top', 'hobby horse', 'crib', 'bassinet', 'rattle']),
  rule('Tools & Hardware', ['toolbox', 'tool', 'wrench', 'hammer', 'handsaw', 'saw', 'hand plane', 'level', 'clamp',
    'vise', 'vice', 'anvil', 'axe', 'hatchet', 'drill', 'pliers', 'chisel', 'hardware', 'hinge', 'padlock',
    'doorknob', 'door knob', 'latch', 'pulley', 'gear', 'yardstick', 'caliper', 'wheelbarrow', 'pitchfork', 'scythe',
    'sickle', 'shovel', 'spade', 'rake', 'sawhorse', 'skeleton key', 'padlock', 'lock']),
  rule('Signage & Advertising', ['signage', 'sign', 'advertising', 'advertisement', 'neon', 'license plate',
    'trade sign', 'marquee', 'pennant', 'banner', 'billboard', 'placard', 'nameplate']),
  rule('Metalware', ['brass', 'copper', 'bronze', 'pewter', 'silverplate', 'silver plate', 'silver', 'cast iron',
    'wrought iron', 'iron', 'tinware', 'toleware', 'onyx', 'marble', 'aluminum', 'aluminium', 'chrome', 'nickel',
    'galvanized', 'enamelware', 'graniteware', 'metal']),
  rule('Storage & Containers', ['box', 'bin', 'crate', 'holder', 'rack', 'hook', 'caddy', 'container', 'organizer',
    'tote', 'barrel', 'pail', 'bucket', 'case', 'strongbox', 'lockbox'])
];

export function categorize(desc) {
  const d = desc || '';
  for (const [name, re] of CATEGORY_RULES) if (re.test(d)) return name;
  return 'Decor & Other';
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const ts = (v) => (v == null || v === 0 ? null : Math.round(Number(v) * 1000));

/** Raw API rows -> a stable internal shape with derived per-item economics. */
export function normalize(raw) {
  return (raw || []).map((r) => {
    const acquired = ts(r.acquired);
    const sold = ts(r.sold);
    const cost = num(r.totalCost) || num(r.originalCost);
    const ask = num(r.askingPrice);
    const soldPrice = sold != null ? num(r.soldPrice) : null;
    const commission = num(r.consignmentPaid);
    const fees = num(r.cardFees);
    const desc = (r.description || '').trim();
    const net = sold != null ? soldPrice - commission - fees : null;
    return {
      id: r.id,
      inv: r.inventoryNumber || '',
      desc: desc || '(no description)',
      category: categorize(desc),
      acquired,
      sold,
      isSold: sold != null,
      cost,
      origCost: num(r.originalCost),
      restoration: Math.max(0, num(r.totalCost) - num(r.originalCost)),
      ask,
      soldPrice,
      commission,
      fees,
      net,
      profit: net != null ? net - cost : null,
      margin: net != null && soldPrice > 0 ? (net - cost) / soldPrice : null,
      markup: cost > 0 ? ask / cost : null,
      discount: sold != null && ask > 0 && soldPrice != null ? 1 - soldPrice / ask : null,
      daysToSell: sold != null && acquired != null ? Math.max(0, (sold - acquired) / DAY) : null,
      store: r.soldStore || null,
      booth: r.soldBooth || null,
      notes: r.notes || '',
      hasBarcode: !!r.barcodeCreated
    };
  });
}

export const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

export function median(values) {
  const v = values.filter((n) => typeof n === 'number' && isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function dataBounds(items) {
  let min = Infinity;
  let max = -Infinity;
  for (const i of items) {
    for (const t of [i.acquired, i.sold]) {
      if (t == null) continue;
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  if (!isFinite(min)) {
    const now = Date.now();
    return { min: now - 365 * DAY, max: now };
  }
  return { min, max: Math.max(max, Date.now()) };
}

/* ---------------------------------------------------------------- buckets */

function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfWeek(t) { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - d.getDay()); return d.getTime(); }
function startOfMonth(t) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
function startOfQuarter(t) { const d = new Date(t); return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime(); }

export function pickGranularity(start, end) {
  const days = (end - start) / DAY;
  if (days <= 45) return 'day';
  if (days <= 200) return 'week';
  if (days <= 1200) return 'month';
  return 'quarter';
}

const FLOOR = { day: startOfDay, week: startOfWeek, month: startOfMonth, quarter: startOfQuarter };

function advance(t, gran) {
  const d = new Date(t);
  if (gran === 'day') d.setDate(d.getDate() + 1);
  else if (gran === 'week') d.setDate(d.getDate() + 7);
  else if (gran === 'month') d.setMonth(d.getMonth() + 1);
  else d.setMonth(d.getMonth() + 3);
  return d.getTime();
}

export function bucketLabel(t, gran) {
  const d = new Date(t);
  if (gran === 'day') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (gran === 'week') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (gran === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  return `Q${Math.floor(d.getMonth() / 3) + 1} '${String(d.getFullYear()).slice(2)}`;
}

export function buildBuckets(start, end, gran) {
  const out = [];
  let t = FLOOR[gran](start);
  let guard = 0;
  while (t <= end && guard++ < 600) {
    const next = advance(t, gran);
    out.push({ t, next, label: bucketLabel(t, gran) });
    t = next;
  }
  return out;
}

/* ----------------------------------------------------------------- venues */

export const shortId = (id) => (id ? String(id).slice(0, 8) : '');
export const UNASSIGNED = '__unassigned__';

/** Rolls a set of sold rows into the numbers we report per venue. */
export function summarizeSales(rows) {
  const gross = sum(rows, (i) => i.soldPrice);
  const commissions = sum(rows, (i) => i.commission);
  const fees = sum(rows, (i) => i.fees);
  const net = gross - commissions - fees;
  const cogs = sum(rows, (i) => i.cost);
  const daysList = rows.map((i) => i.daysToSell).filter((n) => n != null);
  const discountable = rows.filter((i) => i.ask > 0 && i.soldPrice != null);
  return {
    units: rows.length,
    gross,
    commissions,
    fees,
    net,
    cogs,
    profit: net - cogs,
    margin: gross > 0 ? (net - cogs) / gross : null,
    roi: cogs > 0 ? (net - cogs) / cogs : null,
    // Commission can differ per venue, which is exactly what this view is for.
    // Zero-price sales are excluded so this matches the account-wide rate.
    commissionRate: (() => {
      const priced = rows.filter((i) => i.soldPrice > 0);
      const pricedGross = sum(priced, (i) => i.soldPrice);
      return pricedGross > 0 ? sum(priced, (i) => i.commission) / pricedGross : null;
    })(),
    avgSale: rows.length ? gross / rows.length : 0,
    avgProfit: rows.length ? (net - cogs) / rows.length : 0,
    medianDays: median(daysList),
    discountRate: discountable.length
      ? 1 - sum(discountable, (i) => i.soldPrice) / sum(discountable, (i) => i.ask)
      : null
  };
}

/**
 * Every store/booth seen across all sales, for building a stable selector.
 * Venue is only recorded when an item sells, so this can never describe
 * unsold stock — callers must not attribute inventory to a venue.
 */
export function listVenues(items) {
  const stores = new Map();
  const booths = new Map();
  for (const i of items) {
    if (!i.isSold) continue;
    const storeId = i.store || UNASSIGNED;
    if (!stores.has(storeId)) stores.set(storeId, { id: storeId, sales: 0 });
    stores.get(storeId).sales += 1;
    const boothId = i.booth || UNASSIGNED;
    if (!booths.has(boothId)) booths.set(boothId, { id: boothId, store: i.store || UNASSIGNED, sales: 0 });
    booths.get(boothId).sales += 1;
  }
  const bySales = (a, b) => b.sales - a.sales;
  return { stores: [...stores.values()].sort(bySales), booths: [...booths.values()].sort(bySales) };
}

function groupVenues(rows, key) {
  const groups = new Map();
  for (const i of rows) {
    const id = i[key] || UNASSIGNED;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(i);
  }
  const totalNet = sum(rows, (i) => i.net);
  return [...groups.entries()]
    .map(([id, group]) => ({
      id,
      store: key === 'booth' ? group[0].store || UNASSIGNED : null,
      ...summarizeSales(group),
      share: totalNet !== 0 ? sum(group, (i) => i.net) / totalNet : 0
    }))
    .sort((a, b) => b.net - a.net);
}

/* ---------------------------------------------------------------- metrics */

// Monday-first so the weekend reads as a block at the end.
export const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const dowIndex = (t) => (new Date(t).getDay() + 6) % 7;

export const AGING_BUCKETS = [
  ['0–30 d', 0, 30],
  ['31–60 d', 30, 60],
  ['61–90 d', 60, 90],
  ['91–180 d', 90, 180],
  ['181–365 d', 180, 365],
  ['365+ d', 365, Infinity]
];

export const PRICE_BANDS = [
  ['< $10', 0, 1000],
  ['$10–25', 1000, 2500],
  ['$25–50', 2500, 5000],
  ['$50–100', 5000, 10000],
  ['$100–250', 10000, 25000],
  ['$250–500', 25000, 50000],
  ['$500+', 50000, Infinity]
];

/**
 * The core roll-up.
 *  - sales metrics come from items SOLD inside the range
 *  - buying metrics come from items ACQUIRED inside the range
 *  - inventory metrics are a point-in-time snapshot as of the range end
 */
export function analyze(items, range, venue = null) {
  const { start, end } = range;
  const inRange = (t) => t != null && t >= start && t <= end;

  // Venue scoping applies to sales only. Acquisitions and stock on hand carry no
  // venue in Sandpiper's data, so they stay account-wide and are labelled as such.
  const salesInRange = items.filter((i) => inRange(i.sold));
  const matchesVenue = (i) =>
    !venue || !venue.id ||
    (venue.kind === 'store' ? i.store : i.booth) === (venue.id === UNASSIGNED ? null : venue.id);
  const sales = salesInRange.filter(matchesVenue);
  const acquisitions = items.filter((i) => inRange(i.acquired));
  const onHand = items.filter((i) => i.acquired != null && i.acquired <= end && (i.sold == null || i.sold > end));
  const onHandAtStart = items.filter((i) => i.acquired != null && i.acquired < start && (i.sold == null || i.sold >= start));

  const gross = sum(sales, (i) => i.soldPrice);
  const commissions = sum(sales, (i) => i.commission);
  const fees = sum(sales, (i) => i.fees);
  const net = gross - commissions - fees;
  const cogs = sum(sales, (i) => i.cost);
  const profit = net - cogs;

  // Commission rate observed in this account's history (used to project future
  // take-home). Scoped to POS/booth sales so 0%-commission direct-channel sales
  // (Facebook, etc.) don't drag the projection down.
  const pricedAll = items.filter((i) => i.isSold && i.soldPrice > 0);
  const pricedPos = pricedAll.filter((i) => i.channelType === 'pos');
  const priced = pricedPos.length ? pricedPos : pricedAll;
  const grossAll = sum(priced, (i) => i.soldPrice);
  const commissionRate = grossAll > 0 ? Math.min(0.9, sum(priced, (i) => i.commission) / grossAll) : 0.15;

  const askOnHand = sum(onHand, (i) => i.ask);
  const costOnHand = sum(onHand, (i) => i.cost);
  const potentialNet = askOnHand * (1 - commissionRate);
  const potentialProfit = potentialNet - costOnHand;

  const spend = sum(acquisitions, (i) => i.cost);

  const daysList = sales.map((i) => i.daysToSell).filter((n) => n != null);
  const discounts = sales.filter((i) => i.discount != null && i.ask > 0);
  const denominator = onHandAtStart.length + acquisitions.length;

  const gran = pickGranularity(start, end);
  const buckets = buildBuckets(start, end, gran).map((b) => {
    const s = sales.filter((i) => i.sold >= b.t && i.sold < b.next);
    const a = acquisitions.filter((i) => i.acquired >= b.t && i.acquired < b.next);
    const bNet = sum(s, (i) => i.net);
    const bCogs = sum(s, (i) => i.cost);
    return {
      ...b,
      units: s.length,
      gross: sum(s, (i) => i.soldPrice),
      net: bNet,
      cogs: bCogs,
      profit: bNet - bCogs,
      acquired: a.length,
      spend: sum(a, (i) => i.cost)
    };
  });

  let cumProfit = 0;
  let cumNet = 0;
  let cumSpend = 0;
  const cumulative = buckets.map((b) => {
    cumProfit += b.profit;
    cumNet += b.net;
    cumSpend += b.spend;
    return { t: b.t, label: b.label, profit: cumProfit, net: cumNet, spend: cumSpend };
  });

  const aging = AGING_BUCKETS.map(([label, lo, hi]) => {
    const group = onHand.filter((i) => {
      const age = (end - i.acquired) / DAY;
      return age >= lo && age < hi;
    });
    return { label, count: group.length, cost: sum(group, (i) => i.cost), ask: sum(group, (i) => i.ask) };
  });

  const bands = PRICE_BANDS.map(([label, lo, hi]) => ({
    label,
    count: onHand.filter((i) => i.ask >= lo && i.ask < hi).length,
    sold: sales.filter((i) => i.ask >= lo && i.ask < hi).length
  }));

  const catMap = new Map();
  for (const i of onHand.concat(sales)) {
    if (!catMap.has(i.category)) {
      catMap.set(i.category, { name: i.category, onHand: 0, sold: 0, cost: 0, ask: 0, net: 0, profit: 0, cogs: 0 });
    }
  }
  for (const i of onHand) {
    const c = catMap.get(i.category);
    c.onHand += 1; c.cost += i.cost; c.ask += i.ask;
  }
  for (const i of sales) {
    const c = catMap.get(i.category);
    c.sold += 1; c.net += i.net; c.cogs += i.cost; c.profit += i.profit;
  }
  const categories = [...catMap.values()]
    .map((c) => ({
      ...c,
      total: c.onHand + c.sold,
      sellThrough: c.onHand + c.sold ? c.sold / (c.onHand + c.sold) : 0,
      margin: c.net > 0 ? c.profit / c.net : null
    }))
    .sort((a, b) => b.profit - a.profit || b.total - a.total);

  const ageOf = (i) => (i.acquired != null ? (end - i.acquired) / DAY : null);

  /* The same-length window immediately before this one. A figure with nothing to
   * compare against says how big something is but never whether it is improving,
   * which is usually the question being asked. */
  const span = Math.max(1, end - start);
  const prevSales = items
    .filter((i) => i.sold != null && i.sold >= start - span && i.sold < start)
    .filter(matchesVenue);
  const prevAcquired = items.filter((i) => i.acquired != null && i.acquired >= start - span && i.acquired < start);
  const prevSummary = summarizeSales(prevSales);
  const previous = {
    ...prevSummary,
    spend: sum(prevAcquired, (i) => i.cost),
    acquiredUnits: prevAcquired.length,
    // No prior activity means no honest comparison, rather than a growth of infinity.
    hasData: prevSales.length > 0 || prevAcquired.length > 0,
    start: start - span,
    end: start
  };

  // Channel split of the sales in scope, and a booth-only aggregate so
  // rent-coverage and other POS metrics stay honest when direct sales are mixed in.
  const boothSales = sales.filter((i) => i.channelType !== 'direct');
  const boothGross = sum(boothSales, (i) => i.soldPrice);
  const boothNet = boothGross - sum(boothSales, (i) => i.commission) - sum(boothSales, (i) => i.fees);
  const boothProfit = boothNet - sum(boothSales, (i) => i.cost);
  const chanMap = new Map();
  for (const i of sales) {
    const key = i.channel || UNASSIGNED;
    if (!chanMap.has(key)) {
      chanMap.set(key, {
        id: key, type: i.channelType || 'unassigned', label: i.channelLabel || 'Unassigned',
        units: 0, gross: 0, net: 0, cogs: 0, profit: 0
      });
    }
    const r = chanMap.get(key);
    r.units += 1; r.gross += i.soldPrice || 0; r.net += i.net || 0;
    r.cogs += i.cost || 0; r.profit += (i.profit != null ? i.profit : 0);
  }
  const channelBreakdown = [...chanMap.values()].sort((a, b) => b.gross - a.gross);

  return {
    previous,
    range: { start, end, gran },
    counts: {
      total: items.length,
      sold: sales.length,
      onHand: onHand.length,
      acquired: acquisitions.length,
      unpriced: onHand.filter((i) => i.ask <= 0).length,
      zeroCost: onHand.filter((i) => i.cost <= 0).length
    },
    sales: {
      gross, commissions, fees, net, cogs, profit,
      margin: gross > 0 ? profit / gross : null,
      roi: cogs > 0 ? profit / cogs : null,
      avgSale: sales.length ? gross / sales.length : 0,
      avgProfit: sales.length ? profit / sales.length : 0,
      avgDays: daysList.length ? daysList.reduce((a, b) => a + b, 0) / daysList.length : null,
      medianDays: median(daysList),
      discountRate: discounts.length
        ? 1 - sum(discounts, (i) => i.soldPrice) / sum(discounts, (i) => i.ask)
        : 0,
      fullPriceRate: discounts.length
        ? discounts.filter((i) => i.discount <= 0.0001).length / discounts.length
        : null,
      bestMonth: buckets.reduce((a, b) => (!a || b.profit > a.profit ? b : a), null),
      booth: { units: boothSales.length, gross: boothGross, net: boothNet, profit: boothProfit },
      channels: channelBreakdown
    },
    buying: {
      spend,
      units: acquisitions.length,
      avgCost: acquisitions.length ? spend / acquisitions.length : 0,
      restoration: sum(acquisitions, (i) => i.restoration)
    },
    inventory: {
      units: onHand.length,
      cost: costOnHand,
      ask: askOnHand,
      potentialNet,
      potentialProfit,
      commissionRate,
      avgAge: onHand.length ? sum(onHand, (i) => ageOf(i) || 0) / onHand.length : 0,
      medianAge: median(onHand.map(ageOf)),
      stale: onHand.filter((i) => (ageOf(i) || 0) > 180).length,
      staleCost: sum(onHand.filter((i) => (ageOf(i) || 0) > 180), (i) => i.cost),
      avgMarkup: (() => {
        const m = onHand.filter((i) => i.cost > 0 && i.ask > 0).map((i) => i.ask / i.cost);
        return m.length ? median(m) : null;
      })()
    },
    velocity: {
      sellThrough: denominator ? sales.length / denominator : 0,
      turns: costOnHand > 0 ? cogs / costOnHand : 0,
      daysOfSupply: sales.length && (end - start) > 0
        ? onHand.length / (sales.length / ((end - start) / DAY))
        : null
    },
    buckets,
    cumulative,
    aging,
    bands,
    categories,
    lists: {
      topProfit: [...sales].sort((a, b) => b.profit - a.profit).slice(0, 12),
      worstProfit: [...sales].filter((i) => i.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 12),
      fastest: [...sales].filter((i) => i.daysToSell != null).sort((a, b) => a.daysToSell - b.daysToSell).slice(0, 12),
      slowMovers: [...onHand]
        .filter((i) => i.acquired != null)
        .sort((a, b) => a.acquired - b.acquired)
        .slice(0, 12)
        .map((i) => ({ ...i, age: ageOf(i) })),
      biggestBets: [...onHand].sort((a, b) => b.cost - a.cost).slice(0, 12),
      needsPrice: onHand.filter((i) => i.ask <= 0).slice(0, 12)
    },
    venue: venue && venue.id ? venue : null,
    venues: {
      stores: groupVenues(salesInRange, 'store'),
      booths: groupVenues(salesInRange, 'booth'),
      /** Net revenue per period for the top booths — series for a stacked bar. */
      boothSeries: (() => {
        const top = groupVenues(salesInRange, 'booth').slice(0, 5);
        return top.map((v) => ({
          id: v.id,
          values: buildBuckets(start, end, gran).map((b) =>
            sum(salesInRange.filter((i) =>
              (i.booth || UNASSIGNED) === v.id && i.sold >= b.t && i.sold < b.next), (x) => x.net))
        }));
      })()
    },
    scatter: sales
      .filter((i) => i.cost > 0 && i.soldPrice > 0)
      .map((i) => ({ x: i.cost, y: i.soldPrice, label: i.desc, inv: i.inv, profit: i.profit })),
    sales_rows: sales,
    onHand_rows: onHand
  };
}
