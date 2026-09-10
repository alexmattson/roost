# Roost

A Chrome extension that gives [Sandpiper](https://app.sandpiperhq.com) the analytics it doesn't
have, and reconciles those records against the [Quail](https://vendor.quailhq.com)
point-of-sale system behind the stores your stock actually sells through.

Sandpiper tracks what you own and what it cost. Quail knows what was charged, what commission
came off, and when the customer really bought. Neither is a complete account on its own. Roost
pulls both using your existing logged-in sessions, reconciles them into a single ledger, and
renders a dashboard in the toolbar popup. Everything stays in your own browser — no server, no
third-party scripts, nothing phones home.

**[Jump to install →](#install)**

---

## Screenshots

### Analyze — the money ladder, register rhythm and where the stock sits

![Roost's Analyze view: KPI tiles for gross sales, net payout, gross and net profit, stock at cost, asking value, potential profit and sell-through, followed by gross sales by day, cumulative profit, net payout vs cost of goods, a where-the-money-sits donut, buying vs selling, day-of-week and hour-of-day charts, payment mix and recent sales.](docs/screenshot-analyze.png)

### Review — what the two systems disagree about

![Roost's Review view: sales matched, needs attention, sales difference and total findings tiles, a findings-by-type breakdown, data quality checks, and an anomalies table with severity and match chips and inline Fix buttons.](docs/screenshot-review.png)

---

## Features

### Three modes

Views are grouped by the kind of question they answer, not by which system the data came from.
Each mode has its own tabs and its own range presets.

| Mode | Tabs | Kind of question |
| --- | --- | --- |
| **Analyze** | Overview · Sales · Inventory · Catalog · Venues | "how is the business doing" — Overview carries the money ladder and the register's daily view |
| **Review** | *(single page)* | a task list — "what needs fixing" |
| **Records** | Items · POS sales | lookup — "find this specific thing" |

**Each mode owns its date range.** Changing the window in one mode leaves the others alone, and
switching back restores what that mode was showing, custom ranges included. On a fresh open
Analyze starts at All time and Records at 90D. Your last mode, and the last tab within each
mode, are remembered.

**Review has no date picker.** It always covers everything: reconciliation exists to prove the
two systems agree, and a window can only hide a disagreement that is still live. The anomaly
badge counts over that same full range, so it never disagrees with the tab it points at.

The **⤢** button opens the same dashboard full-width in a tab.

### Analytics

Every number respects the selected date range, using the rule that matches the metric:

| Metric group | Basis |
| --- | --- |
| Sales, revenue, profit, margin | items **sold** inside the range |
| Buying, spend, acquisitions | items **acquired** inside the range |
| Inventory, aging, potential profit | a point-in-time **snapshot** as of the range end |

- **Net payout** = gross sales − commission − card fees
- **Gross profit** = net payout − cost of goods (`totalCost`, which includes restoration)
- **Net profit** = gross profit − booth rent, prorated to the window
- **Potential profit** = asking price of unsold stock, less your observed commission rate,
  minus what that stock cost you
- **Commission rate** is derived from your own sales history rather than hard-coded
- Plus ROI, sell-through, inventory turns, days of supply, average and median days to sell,
  average discount off asking price, markup multiple, aging buckets, price bands, and
  per-category performance (categories are inferred from item descriptions)

Headline figures carry a **▲ / ▼ against the previous period of the same length**, shown only
where that period actually had activity to compare against. Compact labels like `$4.8k` can hide
up to $200, so every money KPI carries its exact value in a tooltip.

### Register rhythm, from Quail

Sandpiper's `sold` timestamp is when the sale was keyed in — typically hours later and in
batches (76% of sampled sales land within two minutes of another). Quail's timestamps are the
real register times, which is what makes the daily view on Overview meaningful: daily takings
including dead days, day of week averaged per occurrence, hour of day, basket size and payment
mix. The weekday and hour charts each carry a **$ / Units** toggle, and either way the tooltip
reports both figures.

**Booth rent** is a fixed monthly cost Sandpiper has no field for, so every Sandpiper profit
figure is overstated by it. Roost reports takings after commission *and* rent, prorated to the
elapsed part of the window — charging a full month against a three-day-old month would make a
healthy booth look like a failing one.

### Reconciliation

The Review page joins the two systems on inventory number and reports what disagrees:

| Finding | Meaning |
| --- | --- |
| Sold in Quail, unknown to Sandpiper | POS sale with an inventory number Sandpiper has never seen |
| Sold in Quail, still unsold in Sandpiper | Inventory and potential profit are overstated |
| Sold in Sandpiper, no Quail record | Sold elsewhere, or outside the fetched Quail window |
| Untagged POS sale, probable match | Rang up without a tag; matched to a Sandpiper sale on price and time |
| POS sale with no inventory tag | Rang up without a tag and with no plausible counterpart |
| Sale price disagrees | The two systems recorded different numbers |
| Commission disagrees | The two systems recorded different numbers |
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

Every row carries a **Match** chip saying how far the systems can be trusted to agree:

- **exact** — matched on inventory number in both systems, so the correction is certain
- **probable** — inferred from a matching price and time; worth checking before applying
- **manual** — no automatic fix, this one needs a person

Two ways to apply: **Fix** on a single row, or tick rows and **Resolve selected**. The table
filters by severity, match and kind, and the checkbox in the header selects every fixable row
currently in view — so narrowing to *exact* and selecting all is the deliberate way to clear a
batch. Bulk actions only ever touch visible rows, and a selection is dropped when a filter hides
it, so nothing off-screen can be edited. Selecting a probable match is allowed, but the
confirmation says how many of the batch rest on one.

A single row's **Fix** applies straight away: one deliberate click on one item, with the exact
change already printed beneath the finding. Bulk actions confirm first, listing every field with
its before and after value, because you cannot see all of their changes at once. Edits are
applied one at a time so a partial failure stops somewhere understandable, and the local cache
updates in place as each succeeds, so resolved findings disappear immediately without a full
re-sync.

The Review tab carries a badge with the number of anomalies in range, turning red when any are
high severity, so it is visible from any mode.

### Stores and booths

Sandpiper stamps a store and booth onto an item **only when it sells** (`inBooth` is unused), so
the venue dimension covers sales and cannot describe unsold stock. The dashboard is explicit
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

The sun/moon button in the top bar switches between light and dark. On first run it follows your
OS setting; after that your choice is remembered (`localStorage`, shared by the popup and the
full-tab view). Both themes are driven entirely by CSS custom properties, including the chart
colours: `refreshPalette()` in `lib/charts.js` re-reads the `--chart-*` variables on every
render, so SVG grid lines, axes, crosshairs and series colours all follow the theme without
duplicated colour logic.

---

## Install

Roost is not on the Chrome Web Store. You load it from source as an unpacked extension, which
takes about two minutes.

### 1. Get the code

Clone the repository:

```bash
git clone https://github.com/alexmattson/roost.git
cd roost
```

No build step, no dependencies, no `npm install` — the folder you just cloned is the extension.

> Prefer not to use git? On the [repository page](https://github.com/alexmattson/roost), click
> **Code → Download ZIP**, then unzip it. Keep the unzipped folder somewhere permanent: Chrome
> loads the extension from that path every time it starts, so deleting or moving the folder
> breaks the extension.

### 2. Load it into Chrome

1. Open a new tab and go to **`chrome://extensions`**
   *(you have to type this — links to `chrome://` URLs don't work)*
2. Turn on **Developer mode** using the toggle in the **top right**
3. Click **Load unpacked**, which appears in the top left once Developer mode is on
4. Select the **`roost` folder itself** — the one containing `manifest.json`, not a
   subfolder and not the ZIP file
5. Roost now appears in the list with its version number

### 3. Pin it to the toolbar

Click the puzzle-piece **Extensions** icon to the right of the address bar, find **Roost**, and
click the pin icon. The Roost icon now sits in your toolbar.

### 4. Sign in to both services

In normal browser tabs, sign in to:

- **`app.sandpiperhq.com`** — required; this is where inventory comes from
- **`vendor.quailhq.com`** — optional but strongly recommended; without it you lose real
  register times, booth rent, payment mix and the whole Review page

Roost reads the session cookies these sites already set. It never asks for, sees, or stores your
password.

### 5. Fetch your data

Click the Roost icon, then **Fetch latest data**. The first sync pulls your full item list, your
stores and booths, and Quail's sales and rent history — expect a few seconds. Everything is
cached locally afterwards, so the dashboard opens instantly and the data only changes when you
press that button again.

### Updating

```bash
cd roost
git pull
```

Then go to `chrome://extensions` and click the **reload (↻)** icon on Roost's card. This step
matters: Chrome caches the service worker, so a `git pull` alone will leave the old background
code running. Roost checks for this on open and shows a red banner when the worker's build
doesn't match the manifest version.

### If something goes wrong

| Symptom | Cause and fix |
| --- | --- |
| **"Load unpacked" isn't visible** | Developer mode isn't on. Toggle it in the top right of `chrome://extensions`. |
| **"Manifest file is missing or unreadable"** | You picked the wrong folder. Select the one directly containing `manifest.json`. |
| **The extension vanishes after restarting Chrome** | The source folder was moved, renamed or deleted. Load it again from its permanent location. |
| **An error about your session** | The site's cookie has expired. Open the site, sign in again, then re-fetch. |
| **Red banner about the worker build** | Click the reload (↻) icon on Roost's card. |

---

## How it works

- **Auth** — the service worker reads your `sandpiper_s` session cookie via `chrome.cookies`,
  decodes the JWT to find your account id, and sends the request with both the cookie and an
  `Authorization: Bearer` header. Quail authenticates separately, with
  `Authorization: Basic base64(<vendor email>:<session id>)`, both halves read from its cookies.
  Nothing is stored anywhere but your own browser.
- **Requests** — `POST /api/items/v2/<account>/items?from=0&to=10000000` with
  `{"filters":[],"orderBy":"ACQUIRED","reverse":true}`. The range is deliberately huge so a
  single call returns everything. Then `GET /api/stores/<accountId>` and
  `GET /api/booths/<accountId>` to resolve venue names — note these are **account-scoped list
  endpoints**: they return every store/booth on the account, and passing a store or booth id
  instead returns `403 Forbidden`. Venue failures are reported but never sink an item sync. Each
  Quail refresh pulls booth terms, line-item sales, and one rent call per calendar month; a
  missing Quail session is reported but never blocks an inventory sync.
- **Fallback** — if the direct call is refused, the same request is re-run inside an open
  Sandpiper tab so it goes out same-origin.
- **Storage** — results land in `chrome.storage.local` and the dashboard renders from that cache
  on every open.
- **Charts** — hand-rolled SVG (`lib/charts.js`). Extension CSP blocks remote scripts, so there
  are no third-party libraries.
- **Writes** — `POST /api/items/v2/<accountId>/edit` replaces the whole item rather than patching
  it, so each payload starts from the untouched API row with only the planned fields overlaid —
  that is why the raw rows are cached alongside the normalised ones. A successful edit answers
  **204 No Content**, so responses are read as text and an empty body is treated as success;
  parsing it as JSON unconditionally would report a successful write as a failure *and* trigger
  the in-page fallback to write a second time.

### One set of numbers

`lib/ledger.js` overlays register truth onto the inventory records, pairs untagged register
sales with their Sandpiper counterpart, and adds any sale the register saw that Sandpiper has
not recorded. Every figure in the app reads that one ledger, so two views cannot disagree about
the same window. The raw Sandpiper rows are kept untouched for the Review page, whose job is
precisely to show where the two systems differ.

### Units

All money from the Sandpiper API is in **cents** and is treated as such throughout. Quail mixes
units inside one object: `listPrice`, `salePrice` and `discountAmount` are dollars, while
`taxAmount`, `consignmentAmount` and `cardFeeAmount` are cents. `lib/quail.js` converts
everything to cents at the boundary.

### Layout

| Path | Role |
| --- | --- |
| `manifest.json` | MV3 manifest — permissions, host permissions, service worker, popup |
| `background.js` | Service worker: auth, fetching, caching, writes |
| `popup.html` / `popup.js` / `popup.css` | The dashboard, popup and full-tab alike |
| `theme.js` | Applies the saved theme before first paint (a classic, non-deferred script — MV3's CSP forbids inline scripts, so it can't live in the HTML) |
| `lib/analytics.js` | Metric computation over the ledger |
| `lib/ledger.js` | Reconciles Sandpiper and Quail into one set of numbers |
| `lib/quail.js` | Quail client, unit normalisation, register-rhythm analytics |
| `lib/reconcile.js` | Finds what the two systems disagree about |
| `lib/resolve.js` | Turns a finding into a Sandpiper edit |
| `lib/charts.js` | Hand-rolled SVG charts, theme-aware |
| `tools/make-icons.py` | Regenerates the icon set |

---

## Reference

### Vocabulary

One term per idea, used identically in every card, chart, series and table header. The money
figures form a ladder, and each card names the deduction it just made:

| Term | Meaning |
| --- | --- |
| **Gross sales** | what the register rang up |
| **Commission** | the store's cut |
| **Net payout** | gross sales less commission and card fees — what the store pays you |
| **Cost of goods** | what the stock that sold had cost you |
| **Gross profit** | net payout less cost of goods |
| **Booth rent** | rent for the window, prorated |
| **Net profit** | gross profit less rent — the number that is actually left |
| **Stock at cost** | unsold inventory at what you paid |
| **Asking value** | that same stock at its asking prices |
| **Potential profit** | asking value less commission, less what it cost |

### What the colour bar means

The stripe on a KPI card says one thing only: how that number is doing.

| | |
| --- | --- |
| green | healthy, nothing to do |
| amber | worth an eye |
| red | needs attention |
| none | a descriptive figure with no better or worse direction |

A card whose value has nothing behind it (potential profit with no stock) carries no colour
rather than a flattering green.

---

## Troubleshooting

**Changes to `background.js` don't seem to apply.** MV3 caches the service worker. The popup
files are re-fetched every time you open it, but the worker keeps running whatever was loaded
when the extension was installed. Click the reload (↻) icon on the extension's card at
`chrome://extensions`.

**Watching the requests.** Service worker fetches never appear in the Sandpiper page's Network
tab — only in the worker's own inspector (`chrome://extensions` → Roost → *Inspect views:
service worker*). Note the console only captures logs emitted while it's open, so open it before
hitting fetch. Each sync logs a `[Roost]` line with the venue counts it resolved, and the popup
banner reports the same thing without any DevTools.

**More than one account.** If your login covers several, the first is used. To switch, open the
service worker console from `chrome://extensions` and run:

```js
chrome.runtime.sendMessage({ type: 'setAccount', accountId: '<uuid>' })
```
