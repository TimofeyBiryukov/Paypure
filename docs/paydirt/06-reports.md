# 06 — Reports

Paydirt has three read-only reports under one tabbed section: **Overview**, **Time Logged** and
**Project Budgets**. They are SPA views (Backbone). The figures are computed **server-side**. The
client fetches either JSON (Overview) or a pre-rendered HTML fragment (Time Logged, Project
Budgets) and inserts it into the page.

## Common shell

| Item | Detail |
|---|---|
| Main nav | "Reports" is the first item in the top bar. The logo also links to `/reports`, so Reports is effectively the home page. |
| Page head | Blue band, `h1`. On Overview: "Reports". On sub-reports it is a breadcrumb: `Reports › Time Logged` / `Reports › Project Budgets` (the "Reports" part links to `/reports`). |
| Tabs (right-aligned, in the head band) | `Overview` (`/reports`) · `Time Logged` (`/reports/time_logged`) · `Project Budgets` (`/reports/projects`). The tab whose href matches `location.pathname` gets `.selected`. |
| Page links row | Present but empty. Reports have no action buttons. |
| Right sidebar | The persistent tracker sidebar (task timers). It is not part of the report. |
| Browser titles *(from code)* | "Reports", "Time Logged Report", "Project Budget Report". |
| Loading | `.report-contents.loading` while the fragment loads. On first SPA boot the whole page shows "Loading your data..." with a spinner. |

**Permissions *(from code)*:** the router registers the `reports*` routes **only if the user has both
`view_financial_information` and `manage_invoices`**. If either is missing, the routes don't exist
and the user hits the 404 route. See [07 › Roles & permissions](07-settings-account-team.md#roles--permissions).

---

## 1. Overview (`/reports`)

**Purpose:** a one-glance dashboard of recent time, open quotes, money owed and unbilled work.

**Data:** `GET /reports` (JSON) returns `{ blocks, quotes, invoices, unbilled }`. The view renders
template `reports/index` with it.

### Layout

Four equal columns (`span-5` each, separated by spacers). Each column has an `h2`, a rule, a stack
of "big number + grey caption" pairs, and a footer link row.

| Column | Figures (big number / caption) | Empty state | Footer links |
|---|---|---|---|
| **Time** | 1. `blocks.duration` / "hours logged last 30 days" 2. `blocks.billable_duration` / "billable hours" 3. `blocks.unbillable_duration` / "unbillable hours" | none. Always shows three numbers, e.g. `0.00`. | "Time Logged" → `/reports/time_logged` · "Full Report" → `/time` |
| **Quotes** | For **each currency** in `quotes.drafted`: `<sign> <amount>` / "`<CODE>` drafted". Then for each currency in `quotes.awaiting_approval`: "`<CODE>` awaiting approval". | "No current quotes" (when both maps are empty) | "View Quotes" → `/quotes` |
| **Invoices** | For each currency in `invoices.owing`: "`<CODE>` owing". Then for each currency in `invoices.overdue`: "`<CODE>` overdue". | "No current invoices" (when both are empty) | "View Invoices" → `/invoices` |
| **Unbilled** | For each currency in `unbilled`: "`<CODE>` unbilled" | none. The column is simply empty apart from the link. | "Full Report" → `/clients` |

Example (placeholders): Time `120.00` hours logged last 30 days, `110.00` billable, `10.00` unbillable.
Invoices `$ 1,234.00 USD owing` and `$ 1,234.00 USD overdue`. Unbilled `$ 2,345.00 USD unbilled`
and `$ 99.00 AUD unbilled`.

### How each figure is computed

| Figure | Computation |
|---|---|
| Hours (all three) | Seconds from the server, formatted by `Formatters.secondsToHours` as decimal hours with 2 dp (e.g. `7.50`, not `7:30`). The window is the rolling **last 30 days**. Billable vs unbillable splits by each time entry's (block's) `billable` flag. *(Server-side; the window and split come from the label text.)* |
| Money maps | Each map is keyed by **currency id** → amount. The client looks up `Paydirt.currencies.get(id)` and renders the `sign` in a separate small `span.currency`, the amount via `Formatters.currency(amount, {sign: ""})`, and the ISO `code` in the caption. Amounts in different currencies are **never summed or converted**: one row per currency. |
| Quotes drafted | Sum of totals of quotes in *draft* status, per currency. *(inferred from key name)* |
| Quotes awaiting approval | Sum of totals of sent-but-not-accepted/declined quotes, per currency. *(inferred)* |
| Invoices owing | Outstanding balance of all sent, unpaid invoices (overdue ones included), per currency. *(inferred: in the capture, owing = overdue = the same figure, so owing includes overdue.)* |
| Invoices overdue | Outstanding balance of unpaid invoices past their due date, per currency. |
| Unbilled | Value of billable work not yet on an invoice (unbilled billable time × rate, plus fixed-price tasks and unbilled expenses), per **client currency**. This matches the "unbilled" totals on the Clients list, which is why "Full Report" links to `/clients`. *(inferred)* |

Ordering within a column: drafted before awaiting approval, owing before overdue. Within each group,
the order is the object-key order of the currency ids.

### States

- Loading: the header and tabs render first. The columns are appended when the JSON returns. There is
  no spinner in the body *(from code)*.
- No error state is handled. On a failed request the body just stays blank.

### Screenshot

`screenshots/03-reports-overview.jpg`

---

## 2. Time Logged (`/reports/time_logged`)

**Purpose:** a pivot table of hours and billable value for a period, grouped by team member, client,
project, or client × team member.

### URL state

The query string holds the state and is pushed with `history.pushState` on every change.
Back/forward is handled through `popstate`.

```
/reports/time_logged?target=team&range=week&start=2026-11-16&end=2026-11-22
```

| Param | Values | Default |
|---|---|---|
| `target` | `team`, `client`, `project`, `client and team` | `team` |
| `range` | `day`, `week`, `month`, `quarter`, `year`, `custom` (the model also supports `all-time`, which is not in the UI) | `week` |
| `start` | `YYYY-MM-DD` | start of current `range` |
| `end` | `YYYY-MM-DD`. Only honoured when `range=custom`; otherwise it is recomputed as `start.endOf(range)`. | end of current `range` |

Week boundaries follow moment's locale week, **not** the account's "Week starts on" setting
*(unverified; the capture shows Mon 16 – Sun 22 Nov with the account set to Monday)*.

### Control row ("nav-row")

Reads as a sentence: **Report by** [target ▾] **for the** [range ▾] [date display] … **Download as CSV** … [‹] [⌂] [›]

| Control | Type | Options / behaviour |
|---|---|---|
| Report by | select2 (search hidden), `name=target` | Team member · Client · Project · Client and Team member. On change, `model.set({target})` → refetch. |
| for the | select2, `name=range` | Day · Week · Month · Quarter · Year · Custom. On change, `setRange`: for a fixed range it sets `start=now.startOf(range)` and `end=now.endOf(range)`, so it **jumps to the current period**. For Custom it keeps the current start/end (or defaults to this month if none). |
| Date display (non-custom) | text `div.date-range` + grey hint | Format by range: Day → `16 Nov, 2026`. Week/Month → `16 to 22 Nov, 2026` if same month, else `30 Nov to 6 Dec, 2026`. Quarter/Year → `1 Oct to 31 Dec, 2026`. Hint: `(today)` / `(yesterday)` for day. `(this week)` / `(last week)` (and so on for month, quarter, year) when start equals the current or previous period start. Otherwise blank. |
| Date inputs (custom only) | two jQuery-UI datepicker inputs with calendar icon, "start **to** end" | `setStart`: if the new start is after end, end = start. `setEnd`: if the new end is before start, start = end. Invalid dates revert. |
| Download as CSV | grey link | Navigates to `/reports/time_logged.csv?target&range&start&end`, a server-generated CSV of the same table. *(CSV columns not captured; presumably mirror the table, unverified.)* |
| ‹ (previous period) | button, tooltip "previous period" | `start += -1 range`, `end = start.endOf(range)`. **Disabled when range = Custom.** |
| ⌂ (current period) | button, tooltip "current period" | Resets to `now.startOf/endOf(range)`. Disabled for Custom. |
| › (next period) | button, tooltip "next period" | +1 range. Disabled for Custom. No upper bound, so you can page into the future. |

Every change fetches `GET /reports/time_logged.html?target&range&start&end`. The response is an HTML
table that replaces `.report-contents`.

### Table (team target, as captured)

| Column | Content |
|---|---|
| **Team member** (first column header changes with target: Client / Project; for "Client and Team member" it is grouped, unverified) | Tiny avatar + name |
| **Hours** | Total hours, 2 dp |
| **Billable hours** | `7.50 (100%)`: hours plus share of total |
| **Unbillable hours** | Same format. Shows a grey `–` when zero in body rows. |
| **Billable value** (header `colspan=2`, or one sub-column per currency) | One cell per currency used in the account, e.g. `–` for AUD and `$1,234.00 USD`. Currencies are **side by side, never converted**. Zero shows `–` in rows. |
| (blank header) | "Full report" link → `/time?user=<id>&range=custom&start=…&end=…`, the Time log filtered to that row and period. For client/project rows the filter param is presumably `client` / `project` *(unverified)*. |

**Footer row (`tr.report-totals`)**: "Total" · total hours · billable total `(x%)` · unbillable total
`(y%)`. Zeros show as `0.00 (0%)` here, not `–`. Then one billable-value cell per currency, e.g.
`$0 AUD` and `$1,234.00 USD`.

**Billable value computation:** sum of each billable entry's hours × its effective hourly rate,
where the rate comes from the task's price type (client rate, project rate, custom per-task rate,
or the user's own hourly rate). Fixed-price and not-billable tasks contribute 0 to time value
*(inferred from price types; see 03)*. It is grouped by the client's currency.

### States

- Loading: `.report-contents` gets the `loading` class while fetching.
- Empty period: not captured *(unverified; probably an empty table body with zero totals)*.

### Screenshot

`screenshots/04-reports-time-logged.jpg`

---

## 3. Project Budgets (`/reports/projects`)

**Purpose:** track hours spent against each project's hour **estimate** (budget).

**Data:** `GET /reports/projects` returns a server-rendered HTML fragment into `.report-contents`.
There are no controls: no period, filter, CSV or sorting.

### Which projects appear

Only projects that have an hours estimate (budget) set. A project with a budget but no time logged
still appears at 0%. *(inferred: the captured list contained only budgeted projects, including one
at 0.00 hrs. Archived clients/projects are presumably excluded, unverified.)* Order in the capture
was not by % or name *(unverified; possibly by client then project)*.

### Columns

| Column | Content |
|---|---|
| **Project** | Client avatar/initials badge, client name (blue link to the client page), " – ", project name |
| **Progress** | Progress bar with a percentage label (see below) |
| **Spent** | Hours logged on the project, e.g. `60.00 hrs` (the "hrs" unit is grey) |
| **Budget** | Estimate, e.g. `80.00 hrs` |
| **Remaining** | `Budget − Spent`, e.g. `16.92 hrs`. If negative, it shows **"Over budget by 1.50 hrs"** in orange-red text. |
| (blank) | "Full report" link → time log filtered to the project *(target URL unverified)* |

### Progress bar rules

The same logic is used by the task/project estimate bar (`estimate_progress_bar`, *from code*) and
in `app.css`:

| Ratio `spent / budget` | Class | Colour |
|---|---|---|
| ≤ 80% | (none) | Blue `#579db9`, diagonal-stripe texture image |
| > 80% and < 100% | `warning` | `orange` |
| ≥ 100% | `complete` | Red `#c22228`; the % label moves inside the bar, right-aligned, in white |

- Bar width is clamped to 0–100%. The **label shows the real %**, e.g. "105%", while the bar is full.
- Budget of 0 → 0%.
- Captured examples showed a blue bar under 80%, an orange bar in the 90s, a red bar just over 100%, and an empty grey track at 0%.
- The in-app component's label reads "`NN.NN% of X hours`". The report shows a rounded integer %.

### Screenshot

`screenshots/05-reports-project-budgets.jpg`. The DOM capture
`views/reports_projects.html` only caught the loading state.

---

## Notes for our version

- Multi-currency is handled by listing one row per currency everywhere, and it is never converted.
  That is honest but noisy. Consider an optional "convert to primary currency at today's rate" view.
- The Overview has no period selector (it is a fixed 30-day window) and no trends or charts. A small
  sparkline per column, plus "this month vs last" figures, would add a lot.
- Time Logged returns server HTML, so there is no client-side sort and no drill-down beyond "Full
  report". Return JSON and allow column sorting, a stacked chart, and filters (client, billable)
  together with grouping.
- Project Budgets only tracks hours. Add money budgets (fixed fee vs value of time), a period filter,
  sort by % used, and alert thresholds (the 80% and 100% thresholds are hard-coded).
- Reports require *both* "manage invoices" and "view financial info". Consider a time-only report
  for members without financial access.
