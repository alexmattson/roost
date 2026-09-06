# Sandpiper Analytics

A Chrome extension that adds the analytics dashboard Sandpiper doesn't have. It pulls your
full item list from the Sandpiper API using your existing logged-in session, caches it
locally, and turns it into an interactive dashboard in the toolbar popup.

## Install (developer mode)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose this folder
4. Pin the extension, make sure you're signed in at `app.sandpiperhq.com`, then click the icon
5. Hit **Fetch latest data**

## How it works

- **Auth** — the service worker reads your `sandpiper_s` session cookie via `chrome.cookies`,
  decodes the JWT to find your account id, and sends the request with both the cookie and an
  `Authorization: Bearer` header. Nothing is stored anywhere but your own browser.
- **Requests** — `POST /api/items/v2/<account>/items?from=0&to=10000000` with
  `{"filters":[],"orderBy":"ACQUIRED","reverse":true}`. The range is deliberately huge so a
  single call returns everything. Then `GET /api/stores/<accountId>` and
  `GET /api/booths/<accountId>` to resolve venue names — note these are **account-scoped list
  endpoints**: they return every store/booth on the account, and passing a store or booth id
  instead returns `403 Forbidden`. Venue failures are reported but never sink an item sync.
- **Fallback** — if the direct call is refused, the same request is re-run inside an open
  Sandpiper tab so it goes out same-origin.
- **Storage** — results land in `chrome.storage.local` and the dashboard renders from that
  cache on every open. Data only changes when you press the button again.
- **Charts** — hand-rolled SVG (`lib/charts.js`). Extension CSP blocks remote scripts, so
  there are no third-party libraries and nothing phones home.

All money from the API is in **cents** and is treated as such throughout.

## What it measures

Every number respects the selected date range, using the rule that matches the metric:

| Metric group | Basis |
| --- | --- |
| Sales, revenue, profit, margin | items **sold** inside the range |
| Buying, spend, acquisitions | items **acquired** inside the range |
| Inventory, aging, potential profit | a point-in-time **snapshot** as of the range end |

- **Net revenue** = sale price − consignment/commission − card fees
- **Realized profit** = net revenue − item cost (`totalCost`, which includes restoration)
- **Potential profit** = asking price of unsold stock, less your observed commission rate,
  minus what that stock cost you
- **Commission rate** is derived from your own sales history rather than hard-coded
- Plus: ROI, sell-through, inventory turns, days of supply, average/median days to sell,
  average discount off asking price, markup multiple, aging buckets, price bands, and
  per-category performance (categories are inferred from item descriptions)

### Navigation

Four **modes** sit above the filter bar, each with its own tabs and its own range presets.
The split is by the kind of question a view answers, not by which system the data came from:

| Mode | Tabs | Kind of question |
| --- | --- | --- |
| **Analyze** | Overview · Sales · Inventory · Catalog · Venues | aggregate, ranged — "how is the business doing" |
| **Daily** | *(single page)* | operational — "what happened, and when do we sell" |
| **Review** | *(single page)* | a task list — "what needs fixing" |
| **Records** | Items · POS sales | lookup — "find this specific thing" |

Presets follow the mode: Daily offers Today/7D/30D/This month, Analyze offers 30D through
All time.

**Each mode owns its date range.** Changing the window in one mode leaves the others alone, and
switching back restores what that mode was showing, custom ranges included. Defaults on a fresh
open are All time for Analyze and Review, 30D for Daily, 90D for Records. Daily deliberately
opens on 30D rather than Today, since landing on Today shows an empty screen on any day without
a sale.

Your last mode, and the last tab within each mode, are remembered.

The ⤢ button opens the same dashboard full-width in a tab.

### Quail (point of sale)

Sandpiper tracks inventory; **Quail** (`vendor.quailhq.com`) is the POS the stores actually
sell through, and the two are joined by `externalId`/`externalService` on the Sandpiper store
and booth records. Pressing **Fetch latest data** pulls both.

Quail authenticates separately: `Authorization: Basic base64(<vendor email>:<session id>)`,
both halves read from its cookies. Each refresh pulls booth terms, line-item sales, and one
rent call per calendar month. A missing Quail session is reported but never blocks an
inventory sync.

Two things Quail knows that Sandpiper cannot:

- **When a sale actually happened.** Sandpiper's `sold` is when the sale was keyed in, typically
  hours later and in batches (76% of sampled sales land within two minutes of another). Quail's
  timestamps are the real register times, which is what makes the **Daily** tab meaningful —
  daily takings including dead days, day of week averaged per occurrence, hour of day, basket
  size and payment mix.
- **Booth rent.** A fixed monthly cost Sandpiper has no field for, so every Sandpiper profit
  figure is overstated by it. The Daily tab reports takings after commission *and* rent. Rent is
  prorated to the elapsed part of the window — charging a full month against a three-day-old
  month would make a healthy booth look like a failing one.

**Units warning:** Quail mixes units inside one object. `listPrice`, `salePrice` and
`discountAmount` are dollars; `taxAmount`, `consignmentAmount` and `cardFeeAmount` are cents.
`lib/quail.js` converts everything to cents at the boundary.

### Reconciliation

The **Reconcile** tab joins the two systems on inventory number and reports what disagrees:

| Finding | Meaning |
| --- | --- |
| Sold in Quail, unknown to Sandpiper | POS sale with an inventory number Sandpiper has never seen |
| Sold in Quail, still unsold in Sandpiper | Inventory and potential profit are overstated |
| Sold in Sandpiper, no Quail record | Sold elsewhere, or outside the fetched Quail window |
| Untagged POS sale, probable match | Rang up without a tag; matched to a Sandpiper sale on price and time |
| Sale price / commission disagrees | The two systems recorded different numbers |
| Recorded late | Entered more than three days after it sold |
| Duplicate inventory number | Sandpiper reuses numbers, making any join ambiguous |

An untagged POS sale and an unrecorded Sandpiper sale at the same price within two days are
reported as **one** probable pairing rather than two separate anomalies. Data-quality checks on
the Sandpiper records themselves sit on the same page, since both are things to act on.

### Resolving anomalies

Where a finding can be settled by correcting Sandpiper, the fix is offered inline. Quail is
treated as the register of record: it knows what was actually charged and when, so Sandpiper is
corrected to match it, never the reverse.

| Finding | Fix written |
| --- | --- |
| Sold in Quail, still unsold in Sandpiper | sold date, price, commission, card fees, booth and store |
| Sale price disagrees | sold price |
| Commission disagrees | commission |
| Recorded late | sold date corrected to the register time |
| Untagged POS sale, probable match | aligns date, price and commission — **selection only** |

Three ways to apply: **Fix** on a single row, tick rows and **Resolve selected**, or **Resolve
all exact**. "All" deliberately means all *exact* matches — a probable pairing rests on a
heuristic, so it never goes in a bulk action and has to be picked by hand.

A single row's **Fix** applies straight away: it is one deliberate click on one item, and the
exact change is already printed beneath the finding. Bulk actions confirm first, listing every
field with its before and after value, because you cannot see all of their changes at once.
Edits are applied one at a time so a partial failure stops somewhere understandable, and the
local cache updates in place as each succeeds, so resolved findings disappear immediately
without a full re-sync.

`POST /api/items/v2/<accountId>/edit` replaces the whole item rather than patching it, so each
payload starts from the untouched API row with only the planned fields overlaid — that is why
the raw rows are cached alongside the normalised ones. A successful edit answers **204 No
Content**, so responses are read as text and an empty body is treated as success; parsing it as
JSON unconditionally would report a successful write as a failure *and* trigger the in-page
fallback to write a second time.

### Stores and booths

Sandpiper stamps a store and booth onto an item **only when it sells** (`inBooth` is unused),
so the venue dimension covers sales and cannot describe unsold stock. The dashboard is explicit
about this rather than quietly mixing the two:

- The venue selector beside the date range scopes **sales-derived** figures. Buying and
  inventory stay account-wide, and the footer says so whenever a scope is active.
- The Venues tab always lists every venue, even while a scope is applied, so you can compare.
- Sales with no venue recorded are grouped as *No store/booth recorded* rather than dropped.
- The selector hides itself entirely when there's only one store and one booth.

Booth rows show the commission rate you were **actually** charged next to the `consignmentRate`
on the booth record, and flag the difference in red when they diverge. Names come from the API;
clicking one lets you rename it, and your name always wins (kept in `chrome.storage.local`).

### Appearance

The sun/moon button in the top bar switches between light and dark. On first run it follows
your OS setting; after that your choice is remembered (`localStorage`, shared by the popup and
the full-tab view). `theme.js` is a classic, non-deferred script purely so the theme is applied
before first paint — MV3's CSP forbids inline scripts, so it can't live in the HTML.

Both themes are driven entirely by CSS custom properties, including the chart colours:
`refreshPalette()` in `lib/charts.js` re-reads the `--chart-*` variables on every render, so
SVG grid lines, axes, crosshairs and series colours all follow the theme without duplicated
colour logic.

## Troubleshooting

**Changes to `background.js` don't seem to apply.** MV3 caches the service worker. The popup
files are re-fetched every time you open it, but the worker keeps running whatever was loaded
when the extension was installed. Click the reload (↻) icon on the extension's card at
`chrome://extensions`. The popup checks for this on open and shows a red banner when the
worker's build doesn't match the manifest version.

**Watching the requests.** Service worker fetches never appear in the Sandpiper page's Network
tab — only in the worker's own inspector (`chrome://extensions` → Sandpiper Analytics →
*Inspect views: service worker*). Note the console only captures logs emitted while it's open,
so open it before hitting fetch. Each sync logs a `[Sandpiper Analytics]` line with the venue
counts it resolved, and the popup banner reports the same thing without any DevTools.

## Notes

- If your login covers more than one account, the first one is used. To switch, open the
  service worker console from `chrome://extensions` and run:
  `chrome.runtime.sendMessage({type:'setAccount', accountId:'<uuid>'})`
- An expired session produces a clear message — sign in again and re-fetch.
