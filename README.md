<p align="center">
  <img src="icons/icon128.png" alt="" width="104" height="104">
</p>

<h1 align="center">Roost</h1>

<p align="center">
  <b>Know what your booth actually made.</b><br>
  Analytics and reconciliation for Sandpiper inventory and Quail point-of-sale,<br>
  running entirely in your own browser.
</p>

<p align="center">
  <b>→ <a href="https://alexmattson.github.io/roost/">alexmattson.github.io/roost</a> ←</b>
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#features">Features</a> ·
  <a href="#if-something-goes-wrong">Help</a>
</p>

---

Roost gives [Sandpiper](https://app.sandpiperhq.com) the analytics it doesn't have, and
reconciles those records against the [Quail](https://vendor.quailhq.com) point-of-sale system
behind the stores your stock actually sells through.

Sandpiper tracks what you own and what it cost. Quail knows what was charged, what commission
came off, and when the customer really bought. Neither is a complete account on its own. Roost
pulls both, reconciles them into a single ledger, and renders a dashboard — right in your
browser. There is no server: the page talks to Sandpiper and Quail directly, and everything
stays with you. No accounts to create, no third-party scripts, nothing phones home.

---

## Screenshots

### Analyze — the money ladder, register rhythm and where the stock sits

![Roost's Analyze view: KPI tiles for gross sales, net payout, gross and net profit, stock at cost, asking value, potential profit and sell-through, followed by gross sales by day, cumulative profit, net payout vs cost of goods, a where-the-money-sits donut, buying vs selling, day-of-week and hour-of-day charts, payment mix and recent sales.](docs/screenshot-analyze.png)

### Sync — what the two systems disagree about

![Roost's Sync view: sales matched, needs attention, sales difference and total findings tiles, a findings-by-type breakdown, data quality checks, and an anomalies table with severity and match chips and inline Fix buttons.](docs/screenshot-review.png)

---

## Features

### Modes

Views are grouped by the kind of question they answer, not by which system the data came from.
Roost opens on **Home**, a calm briefing; the analytical depth is a click away, not the front door.

| Mode | Tabs | Kind of question |
| --- | --- | --- |
| **Home** | *(single page)* | "what should I care about" — take-home for the last 30 days, a short list of what needs attention, and the last few sales, each a doorway into the depth |
| **Analyze** | Overview · Sales · Inventory · Catalog · Venues | "how is the business doing" — Overview carries the money ladder and the register's daily view |
| **Sync** | *(single page)* | a task list — "what needs fixing", and where the two systems are brought into line |
| **Records** | Items · POS sales | lookup — "find this specific thing", each page answering for one system |

**Home is the entry point, not a dashboard.** It answers the two questions a booth owner actually
has on arrival — did I make money, and what do I need to do — and every panel is a doorway rather
than a destination. The actionable data-quality findings (stock with no price, stock at $0 cost,
stock held too long, register sales not yet in Sandpiper) live here now, since those are the most
pressing things and a briefing is where you want to meet them.

**Each mode owns its date range.** Changing the window in one mode leaves the others alone, and
switching back restores what that mode was showing, custom ranges included. On a fresh open
Analyze starts at All time and Records at 90D. Your last mode, and the last tab within each
mode, are remembered.

**Sync has no date picker.** It always covers everything: reconciliation exists to prove the
two systems agree, and a window can only hide a disagreement that is still live. The anomaly
badge counts over that same full range, so it never disagrees with the tab it points at.


### Analytics

Every number respects the selected date range, using the rule that matches the metric:

| Metric group | Basis |
| --- | --- |
| Sales, revenue, profit, margin | items **sold** inside the range |
| Buying, spend, acquisitions | items **acquired** inside the range |
| Inventory, aging, potential profit | a point-in-time **snapshot** as of the range end |

- **Net payout** = gross sales − commission − card fees
- **Take-home** = net payout − booth rent, prorated to the window — the money the store
  actually hands over
- **Net profit** = take-home − cost of goods (`totalCost`, which includes restoration)
- **Gross profit** = net payout − cost of goods — profit before rent, which is why Overview
  leads with take-home instead and gross profit sits on the Sales tab
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
including dead days, day of week averaged per occurrence, hour of day, and basket size. The
daily, weekday and hour charts each carry a **$ / Units** toggle, and either way the tooltip
reports both figures. Payment method stays a column and a filter on the POS sales table, where
it is something you search by rather than a chart that reads the same every time.

**Booth rent** is a fixed monthly cost Sandpiper has no field for, so every Sandpiper profit
figure is overstated by it. It is also the cost that arrives whether or not anything sells,
which is why Overview charts net payout against rent over twelve months — the keep-or-drop
question needs a direction, and a single "rent covered" percentage cannot show one. Roost reports takings after commission *and* rent, prorated to the
elapsed part of the window — charging a full month against a three-day-old month would make a
healthy booth look like a failing one.

### Reconciliation

The Sync page joins the two systems on inventory number and reports what disagrees:

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
reported as **one** probable pairing rather than two separate anomalies, so Sync stays a clean
list of what disagrees.

The data-quality findings that used to sit beside it — stock with no asking price, stock at $0
cost, stock held over 180 days, register sales not yet in Sandpiper — now live on **Home**, since
those are the most pressing things to act on. Each is a button that opens Records filtered to
exactly those items, and the window travels with the click, so the rows listed are the same rows
the number counted.

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

The Sync tab carries a badge with the number of anomalies in range, turning red when any are
high severity, so it is visible from any mode.

### Price tags

Records → Items can print price tags for whatever the filters are showing — each with the
description, asking price, inventory number, and a **Code 128 barcode** of that number. That's the
same symbology Sandpiper prints and the value the register scans, so a tag from here scans and
reconciles like a Sandpiper one, drawn as inline SVG with no dependency. The **No barcode yet**
filter narrows to on-hand stock that hasn't been tagged, so adding a box and tagging it is filter
→ Print → done. The preview on screen is exactly what prints; everything else is hidden from the
page at print time.

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
clicking one lets you rename it, and your name always wins (kept in your browser).

### Appearance

The sun/moon button in the top bar switches between light and dark. On first run it follows your
OS setting; after that your choice is remembered in your browser. Both themes are driven entirely
by CSS custom properties, including the chart
colours: `refreshPalette()` in `lib/charts.js` re-reads the `--chart-*` variables on every
render, so SVG grid lines, axes, crosshairs and series colours all follow the theme without
duplicated colour logic.

---

## Get started

Open **[alexmattson.github.io/roost](https://alexmattson.github.io/roost/)** and sign in to your
two accounts, each in its own row:

- **Sandpiper** — your Sandpiper email and password. Required; it's where inventory comes from.
- **Quail** — your Quail vendor email and password. Optional, but without it you lose real sale
  times, booth rent, and the whole Sync page.

Click **Connect** on each. Once Sandpiper shows connected, click **Enter Roost**, then **Fetch
latest data**. The first load takes up to a minute while it pulls everything down; after that the
dashboard opens instantly and refreshes only when you ask.

There's nothing to install — it runs in any modern browser on a computer. Your passwords never
leave your browser: each is sent straight to its own service, exchanged for a session token, and
the password itself is discarded. The tokens are held only until you close the tab.

### If something goes wrong

| What you're seeing | What it means |
| --- | --- |
| **"Sandpiper rejected the sign-in"** (or Quail) | Wrong email or password, or the account has no access. Try signing in on the vendor's own site to check. |
| **A message about your session** | The token expired — reconnect that system. |
| **Everything is empty** | You haven't pressed **Fetch latest data** yet. |
| **Signed out when you reopen** | Tokens are kept only for the tab's lifetime, so closing it signs you out. Connect again. |

### Good to know

- **Your data stays in your browser.** The page talks to Sandpiper and Quail directly; there is
  no Roost server to send anything to. Tokens live in `sessionStorage` (gone when the tab closes),
  the fetched data in `localStorage`, both on your machine only.
- **You are typing vendor passwords into a page that isn't the vendor.** Roost only exchanges each
  for a token and never stores or forwards it — but if that gives you pause, that's a fair
  instinct, and a good reason to run [your own copy](#host-your-own-copy) on a domain you trust.
- **It leans on how the two APIs are configured today.** Both currently allow a browser on another
  site to call them; if either changes that, the site would need adjusting.

### Host your own copy

The site is just static files, served by GitHub Pages straight from the repository:

1. Fork or clone [github.com/alexmattson/roost](https://github.com/alexmattson/roost).
2. In your fork, **Settings → Pages → Build and deployment**: set **Source** to *Deploy from a
   branch*, pick **main** and **/ (root)**, and **Save**.
3. A minute later it is live at `https://<you>.github.io/roost/`.

No build step and no dependencies — the repository is the site.

## How it works

- **Auth** — both systems sign in on the page, since both login endpoints live under `/api`, which
  sends CORS. **Sandpiper**'s `api/login/do-login` takes `{username, password}` and returns a JWT
  in the body; the account id is decoded from it, and it rides on every call as
  `Authorization: Bearer`. **Quail**'s `api/auth/login` returns a session id in the body, which
  becomes `Authorization: Basic base64(<vendor email>:<session id>)`. Each password is sent only
  to its own service and never stored; nothing is kept anywhere but your own browser.
- **Requests** — `POST /api/items/v2/<account>/items?from=0&to=10000000` with
  `{"filters":[],"orderBy":"ACQUIRED","reverse":true}`. The range is deliberately huge so a
  single call returns everything. Then `GET /api/stores/<accountId>` and
  `GET /api/booths/<accountId>` to resolve venue names — note these are **account-scoped list
  endpoints**: they return every store/booth on the account, and passing a store or booth id
  instead returns `403 Forbidden`. Venue failures are reported but never sink an item sync. Each
  Quail refresh pulls booth terms, line-item sales, and one rent call per calendar month; a
  missing Quail session is reported but never blocks an inventory sync.
- **Storage** — the fetched data lands in `localStorage` and the dashboard renders from that cache
  on every open; session tokens sit in `sessionStorage`, so they clear when the tab closes.
- **Charts** — hand-rolled SVG (`lib/charts.js`). The page loads no third-party scripts, so there
  are no charting libraries and nothing to phone home.
- **Writes** — `POST /api/items/v2/<accountId>/edit` replaces the whole item rather than patching
  it, so each payload starts from the untouched API row with only the planned fields overlaid —
  that is why the raw rows are cached alongside the normalised ones. A successful edit answers
  **204 No Content**, so responses are read as text and an empty body is treated as success;
  parsing it as JSON unconditionally would report a successful write as a failure.

### One set of numbers

`lib/ledger.js` overlays register truth onto the inventory records, pairs untagged register
sales with their Sandpiper counterpart, and adds any sale the register saw that Sandpiper has
not recorded. Every **business figure** reads that one ledger, so two views cannot disagree
about the same window.

Records is the deliberate exception. Its two pages are lookup, not analysis, and each answers
for a single system: **Items** is what Sandpiper holds, **POS sales** is what the register
rang. Merging them there would mean editing a row while looking at another system's version of
it — which is also why Items is the one place edits can be trusted to show up exactly as typed.
Sync is where the two are held against each other.

### Units

All money from the Sandpiper API is in **cents** and is treated as such throughout. Quail mixes
units inside one object: `listPrice`, `salePrice` and `discountAmount` are dollars, while
`taxAmount`, `consignmentAmount` and `cardFeeAmount` are cents. `lib/quail.js` converts
everything to cents at the boundary.

### Layout

A static site: one HTML page, plain ES modules, no build step, no dependencies.

| Path | Role |
| --- | --- |
| `index.html` / `popup.js` / `popup.css` | The whole app — one page, its controller, its styles |
| `main.js` | Entry point; starts the controller |
| `lib/core.js` | The API orchestration — which endpoints, in what order |
| `lib/webbackend.js` | Sign-in, fetching, and the `localStorage` cache |
| `lib/platform.js` | The seam the controller talks to for storage and fetching |
| `theme.js` | Applies the saved theme before first paint (a classic, non-deferred script, so the page never flashes the wrong theme) |
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
figures form a ladder — one deduction per rung, in the order the money actually leaves — and
each card names the deduction it just made:

| Term | Meaning |
| --- | --- |
| **Gross sales** | what the register rang up |
| **Commission** | the store's cut |
| **Net payout** | gross sales less commission and card fees |
| **Booth rent** | rent for the window, prorated |
| **Take-home** | net payout less rent — what the store actually pays you |
| **Cost of goods** | what the stock that sold had cost you |
| **Net profit** | take-home less cost of goods — the number that is actually left |
| **Gross profit** | net payout less cost of goods — profit before rent |
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

## Developer notes

These are for people working on Roost itself — if you're just using it, the
[help table above](#if-something-goes-wrong) is the one you want.

**Running it locally.** Any static server works, since ES modules won't load over `file://`:

```bash
git clone https://github.com/alexmattson/roost.git
cd roost
python3 -m http.server        # then open http://localhost:8000/
```

No install and no build — edit a file, reload the page.

**Watching the requests.** Every fetch goes straight from the page, so it all shows up in the
browser's own Network tab. Each sync also logs a `[Roost]` line with the venue counts it resolved,
and the sign-in banner reports the same thing without any DevTools.

**More than one account.** If your Sandpiper login covers several, the first is used.
