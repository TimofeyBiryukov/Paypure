# 01 — Information architecture

How Paydirt is organised: the page frame that wraps every screen, the complete route map, which
routes each permission unlocks, how navigation works, and the behaviours that apply everywhere.

Sources: SPA router (`Paydirt.Router`), route helpers (`Paydirt.Routes`), `Paydirt.Sections`,
HAML templates in `app.js`, rendered views, server-rendered pages, screenshots 03, 07, 15, 16, 20,
39. Items read from code but not seen in the UI are marked *(from code)*.

---

## 1. Global layout

Every logged-in page (SPA and server-rendered) uses the same frame, top to bottom:

```
┌──────────────────────────────────────────────────────────────┬───────────────┐
│ #header  (near-black top nav, 47px)                          │               │
│ [logo] Reports Clients Time Quotes Invoices    Settings [⏻]  │   Tracker     │
├──────────────────────────────────────────────────────────────┤   sidebar     │
│ #page-head  (blue band, #579db9)                             │   (fixed,     │
│   .page-title    H1 title / breadcrumb  (Clients › Acme Co)  │    325px,     │
│   .page-links    [Action] [Action ▾] [Action]                │    right)     │
│   .action-bar    (hidden inline form, slides open)           │               │
│   .page-tabs     ............................ [Tab][Tab][✎Tab]│               │
├──────────────────────────────────────────────────────────────┤               │
│ #middle  (beige #f5f0ea, padding 30px 50px)                  │               │
│   .container  (min 950px, max 1200px, centred)               │               │
│       page content                                           │               │
├──────────────────────────────────────────────────────────────┤               │
│ #foot (darker beige #f0e9e0): Resources | Video guides |     │               │
│        Contact Us | "How can we improve?" feedback box       │ [Undock][Hide]│
└──────────────────────────────────────────────────────────────┴───────────────┘
#flash: toast, fixed bottom-centre, 900px wide slot
```

### 1.1 Top navigation bar (`#header #primary_nav`)

| Element | Detail |
|---|---|
| Container | `.container` → `.span-24.last.relative`; height 47px; background `#1a1a1a` |
| Logo | "paydirt" wordmark image, links to `/reports` (`data-behaviour="backbone_link"`). In `body.app` CSS hides `.logo` in the footer only |
| Primary nav (`#nav`, left) | `Reports` (`/reports`), `Clients` (`/clients`), `Time` (`/time`), `Quotes` (`/quotes`), `Invoices` (`/invoices`). Each is an `li#nav-<section>` |
| Selected state | Router adds `.selected` to the `li` whose prefix matches the URL: `/reports*` → Reports, `/clients*` → Clients, `/time*` → Time, `/quotes*` → Quotes, `/invoices*` **and** `/recurring_invoices*` → Invoices. Selected = text `#579db9`, `rgba(0,0,0,.25)` bg, inset black shadow |
| Account nav (`#account_nav`, right) | `Settings` (`/settings`, full page load), log-out icon `icon-signout` (`/logout`, tooltip "Log out", gravity n) |
| Separators | Vertical separator image between items (`header_separator.png`) |
| Visibility of items | The nav items are always rendered in the shell; permission gating happens in the router (a hidden route falls to the 404 view) *(from code)*. Timesheets/Running timers are tabs, not nav items |

### 1.2 Page header band (`#page-head`)

Rendered per view (HAML template or React `Paydirt.Components.PageHead`). Four optional rows:

| Row | Class | Content | Style |
|---|---|---|---|
| Title | `.page-title` | `<h1>`: plain title ("Invoices") or breadcrumb: links separated by `icon-angle-right` (e.g. `Clients › Acme Co`, `Invoices › INV 0042 › Edit`). Last crumb is plain text or a link to the current record | white, Open Sans 300, 32px / 50px line, padding 15px 50px; chevrons 22px `rgba(255,255,255,.5)` |
| Optional status label | `span.label.enabled/.disabled` floated right in title row | Recurring invoices only: "enabled" (green `#44aa77`) / "disabled" (red `#DA3838`) | 16px, radius 5px |
| Links (actions) | `.page-links` (`.sml` = 12px variant) | Action buttons `a.action`, button groups `.action-group` (joined buttons), split buttons with caret dropdown (`.btn-group` + `.dropdown-toggle` + `ul.dropdown-menu`) | darker blue buttons `#387087`, border `#2d5b6e`, radius 2px; row background `rgba(0,0,0,.03)` |
| Action bar | `.action-bar` (hidden by default) | Inline creation form that slides open under the links, e.g. "New Client: [Business name] Add Client or Add and edit details"; New Invoice/Quote panel (client picker) | same tint as links row, padding 8px 50px |
| Tabs | `.page-tabs > .secondary_navigation` | Right-aligned tabs sitting on the band's bottom edge (absolutely positioned, `bottom:-1px; right:0`) | inactive: `#387087` fill, white text; selected: beige `#f5f0ea` fill, `#387087` text, so it merges with the page body; radius 3px 3px 0 0; 35px tall; 15px font |

Pages without a blue band: all `/settings/*` pages (they use a left settings nav instead, see §3.4),
public/print pages.

### 1.3 Content area

| Property | Value |
|---|---|
| `#main` | `min-height:600px; background:#f5f0ea` |
| `#middle` | `padding:30px 50px` |
| `.container` | `margin:0 auto; min-width:950px; max-width:1200px` (Blueprint grid overridden to fluid %) |
| `body.app` | `min-width:1050px; background:#f0e9e0` |
| `body.with_invoice` (invoice pages) | `min-width:1245px`, container fixed at 1145px |
| Grid | Blueprint-style 24 columns `.span-1…24`, fluid: `.span-N` width = N/24 minus 2% gutter, `.last` removes right margin |

### 1.4 Footer (`#foot`)

Four columns on beige `#f0e9e0`, top border `#e2dcd4`, padding 55px 0 40px. Headings `#ac9881`
15px, links `#b6a590` (hover underline).

| Column | Items |
|---|---|
| Resources (`.span-5`) | Getting Started Guides (`/help/guides`), Paydirt Blog (external), Privacy Policy (`/privacy`), Terms of Service (`/terms`), Chrome Extension (Chrome Web Store, `data-behaviour="install_chrome_extension"`) |
| Video guides (`.span-5`) | Creating Projects & Tasks, Tracking Time, Using the Chrome Extension, Creating Invoices, Online Payments — each opens a YouTube embed in a modal (`data-behaviour="youtube-modal"`) |
| Contact Us (`.span-5`) | support email (mailto), Twitter, Facebook |
| How can we improve? (`.span-8.last`, `#footer_feedback`) | `textarea#feedback` placeholder "Your suggestions and feedback will help us improve Paydirt. Thank you!"; on focus the submit row fades in; button "Tell it like it is" (`.arrow.button`). Posts `POST /feedback` (remote/AJAX). States: "Sending..." (disabled) → replaced by "Thanks for your feedback!" ; error message on failure |

### 1.5 Tracker sidebar (right)

A React app (`Paydirt.Components.TimeTracker.Container`) mounted into `.tracker-container` on
**every** page, including settings. Full spec in [04 — Time tracking](04-time-tracking.md); IA-relevant facts:

| Aspect | Detail |
|---|---|
| Position | `position:fixed; top:0; bottom:0; right:0; width:325px; z-index:99`, translucent black `rgba(0,0,0,.6)` |
| Modes | `tracker-main` (task search/start list) and `recent-blocks` (log of today/yesterday), slide left/right (0.5s); toggle via round button `.blocks-tracker-toggle` (`icon-list`/`icon-time`) in footer |
| Header | "Search for a task..." input; links "start timer and choose task later", "assigned tasks" |
| Body | Tasks grouped by `Client / Project` (badge + name) with per-task `▶` start button and `⋮` options dropbubble |
| Footer (40px, `#222`) | "Undock" (`icon-upload-alt`, opens `/tracker` in a 325×622 popup window) · "Hide" (`icon-circle-arrow-right`) |
| States | `.showing` (docked, visible) / hidden (slid off-screen, `right:-325px`); `body.extension` variant used inside the Chrome extension |
| Empty | "There are no tasks for you to track time towards..." / "You haven't set up any tasks for time tracking yet. Head here to get started." (`/welcome`) |
| Data | Initial data from `/data/all` (`tracker_jobs`, `running_block`, `recent_blocks`); refresh via `/data/tracker`, `/data/tracker_jobs`; live updates via Pusher |

---

## 2. Sitemap / route table

### 2.1 SPA routes (Backbone router, `pushState`)

The router is only started when the path is **not** `/settings*`, `/intent*`, `/welcome*`,
`/users*`, `/document_emails*` or `/tracker*` *(from code)*. All SPA URLs are also valid
server URLs that return the same shell (`pages/invoices.html` etc.).

| Route | Handler | View / component | Page title (`Paydirt: …`) | Data fetched | Gate |
|---|---|---|---|---|---|
| `/reports` | reportsIndex | `Views.ReportsIndex` | Reports | — | financial **and** invoices |
| `/reports/time_logged` | reportsTimeLogged | `Views.ReportsTimeLogged` | Time Logged Report | report API | financial **and** invoices |
| `/reports/projects` | reportsProjects | `Views.ReportsProjects` | Project Budget Report | — | financial **and** invoices |
| `/time` | blocksIndex | `Views.Blocks.Index` (graph + summary + list) | Time Logged | `GET /data/clients_and_projects`, then `GET /time/search?…` | everyone |
| `/time/log` | blocksNew | `Views.Blocks.New` | Log Time Worked | query params prefill: `job_id`, `start_time`, `end_time`, `start_date`, `end_date` (any of the time params sets `duration_only=false`) | everyone |
| `/time/:id/edit` | blocksEdit | `Views.Blocks.Edit` | Edit Log Entry | `GET /time/:id`; on failure redirect to `/time` | everyone |
| `/time/:id/duplicate` | blocksDuplicate | `Views.Blocks.Duplicate` | Copy an existing log | `GET /time/:id` (id cleared) | everyone |
| `/time/running` | blocksRunning | React `RunningBlockList` | Running Timers | `GET /time/running` | view_all_time_logged |
| `/timesheets` | timesheets | React `TimesheetList` | My Timesheets | `GET /timesheets` | everyone (tab shown only if `user.submits_timesheets`) |
| `/timesheets/:date` | timesheet | React `Timesheet` (`week_number` param) | A Timesheet | `GET /timesheets/:week` | everyone |
| `/timesheets/submitted` | submittedTimesheets | React `SubmittedTimesheetList` | Submitted Timesheets | `GET /timesheets/submitted` | manage_account **and** `account.timesheet_approval` |
| `/timesheets/submitted/:id` | submittedTimesheet | React `SubmittedTimesheet` | Timesheet | `GET /timesheets/submitted/:id` | same |
| `/clients` | clientsIndex | `Views.Clients.Index` (active) | Clients | in-memory `Paydirt.clients` | view_financial_information |
| `/clients/archived` | clientsArchived | `Views.Clients.Index` (inactive) | Archived Clients | in-memory | view_financial_information |
| `/clients/new` | clientsNew | `Views.Clients.New` | Add a Client | — | view_financial_information |
| `/clients/:id` | clientsShow | `Views.Clients.Show` + sub-view `Clients.Work` | {business name} | `GET /clients/:id` (client + projects → Redux store) | view_financial_information |
| `/clients/:id/invoices/new[?for=projectId]` | clientsNewInvoice | `Clients.Show` + `Clients.NewInvoice` | — | `GET /clients/:id/projects[/:pid]?include_completed_jobs=true` | view_financial_information |
| `/clients/:id/keywords` | clientsKeywords | `Clients.Show` + `Clients.Keywords` | — | `GET /clients/:id` | view_financial_information |
| `/clients/:id/edit` | clientsEdit | `Clients.Show` + `Clients.Edit` | Edit {business name} | `GET /clients/:id` | view_financial_information |
| `/quotes` | quotesIndex | `Views.Quotes.Index` | Current Quotes | `/quotes/search.html` | manage_invoices |
| `/quotes/:id` | quotesShow | `Views.Quotes.Show` | Quote {number} ({client}) | `GET /quotes/:id` (quote, emails, activities, page HTML); fail → `/quotes` | manage_invoices |
| `/quotes/:id/edit` | quotesEdit | `Views.Documents.Edit` | Edit Quote {number} ({client}) | `GET /quotes/:id/edit` (quote, taxes, line_items, preset_line_items) | manage_invoices |
| `/invoices` | invoicesIndex | `Views.Invoices.Index` | Current Invoices | `/invoices/search.html` | manage_invoices |
| `/invoices/recurring` | invoicesRecurring | `Views.RecurringInvoices.Index` | Recurring Invoices | `GET /recurring_invoices` | manage_invoices |
| `/invoices/:id` | invoicesShow | `Views.Invoices.Show` | Invoice {number} ({client}) | `GET /invoices/:id` (invoice, emails, payments, activities, page HTML); fail → `/invoices` | manage_invoices |
| `/invoices/:id/edit` | invoicesEdit | `Views.Documents.Edit` | Edit Invoice {number} ({client}) | `GET /invoices/:id/edit` | manage_invoices |
| `/invoices/:id/add` | invoicesAdd | `Views.Documents.Add` | Add to Invoice … | `GET /invoices/:id/add?include_completed_jobs=true` | manage_invoices |
| `/recurring_invoices/:id` | recurringInvoicesShow | `Views.Invoices.ShowRecurring` | Recurring Invoice {number} … | `GET /recurring_invoices/:id`; fail → `/invoices/recurring` | manage_invoices |
| `/recurring_invoices/:id/edit` | recurringInvoicesEdit | `Views.Documents.Edit` | Edit Recurring Invoice {number} ({client}) | `GET /recurring_invoices/:id/edit` | manage_invoices |
| `/recurring_invoices/:id/schedule` | recurringInvoicesSchedule | `Views.Documents.Schedule` | Edit Schedule: Recurring … | `GET /recurring_invoices/:id` | manage_invoices |
| `*404` (anything else) | render404 | `Views.PageNotFound` | Page Not Found | — | everyone |

Note: `/clients/:id/invoices/new` in the brief's list is the "Select Time & Expenses to Invoice"
builder; `/invoices/:id/add` is the same builder for adding to an existing invoice.

### 2.2 Server-rendered app pages (full page load, no SPA router)

| Path | Page | Notes |
|---|---|---|
| `/settings` | Profile ("Your Settings") | name, email, avatar, time zone, … |
| `/settings/password` | Password | also shows the user's API key (per API docs) |
| `/settings/account` | Account Preferences | currency, default pricing, email prefs, week start, timesheet approval |
| `/settings/account/business` | Business Details | |
| `/settings/account/plan` | Paydirt Plan | plan picker, coupon; links `/stripe/receipts` |
| `/settings/account/integrations` | Integrations | Trello, Basecamp, Redbooth connect |
| `/settings/account/default_tasks` | Preset Tasks | React `DefaultJobGroupList` |
| `/settings/account/data` | Account Data | `/export/time` (CSV), `/export/invoices` (ZIP), `/export/quotes` (ZIP), "Cancel my subscription" → `/stripe/churn_survey` |
| `/settings/documents/defaults` | Quote & Invoice defaults | payment terms, footers, logo, default taxes |
| `/settings/documents/payments` | Online Payments | PayPal / Stripe *(not captured)* |
| `/settings/documents/line_items` | Line Item Creation | rounding & grouping |
| `/settings/documents/inventory` | Inventory | Preset line items (Backbone `PresetLineItems.Index`) |
| `/settings/documents/email_templates` | Email Templates | quote, invoice, overdue reminder, thank-you |
| `/settings/team` (= `/users`) | Team Members | |
| `/users/new` | Invite Member | redirects to plan picker when out of seats |
| `/users/invite_multiple` | Quick-add your team | |
| `/settings/extensions/keywords` | Keywords | for Chrome extension |
| `/integrations/trello/connect`, `/integrations/{trello,basecamp,redbooth}/import_people` | Integration flows | |
| `/stripe/receipts`, `/stripe/receipt/:id(.pdf)` | Subscription receipts | |
| `/stripe/churn_survey` | Cancellation survey | |
| `/tracker` | Undocked tracker window | `Paydirt.tracker_initialize` |
| `/welcome` | Onboarding | linked from tracker empty state |
| `/document_emails/new?document_id=&type=` | Compose document email (modal) | types: quote/invoice/reminder/`thankyou` (+`invoice_payment_id`) |
| `/default_job_groups/import?project_id=`, `/default_job_groups/import_project?client_id=` | Modal content | import preset tasks |
| `/clients/:id/projects/:pid/move` | Modal content | Move project |
| `/help/guides…`, `/privacy`, `/terms` | Help & legal | |
| `/logout` | Log out | |

### 2.3 Public / document output pages

| Path | Audience | Purpose |
|---|---|---|
| `/invoices/:id/view/:private_id` | Client (no login) | Payment page: invoice + PayPal/Stripe pay buttons ("Payment Page" button) |
| `/quotes/:id/view/:private_id` | Client | Online quote ("View Online") |
| `/invoices/:id/print`, `/quotes/:id/print` | User | Print layout (opens new tab) |
| `/invoices/:id.pdf`, `/quotes/:id.pdf` | User/client | PDF download ("Get PDF") |
| `/timesheets/:week/print`, `/timesheets/:week.pdf`, `/timesheets/submitted/:id/print`, `.pdf` | User/manager | Timesheet output *(from code)* |
| `/time/print?…`, `/time/export?…` | User | Print list / CSV of the current Time filter |
| `/free_invoice_creator`, `/free_quote_template` (+ `/print`, `/pdf`) | Anyone (marketing) | Free stand-alone invoice/quote generator using the same editor (`FreeformInvoice`/`FreeformQuote`) |
| `/documentation/api/{introduction,clients,projects,jobs,time,users}` | Developers | Public API docs (see [08](08-data-model-and-api.md)) |

---

## 3. Navigation patterns

### 3.1 Tab sets per section

| Section | Tabs (left→right) | Selected rule |
|---|---|---|
| Reports | Overview · Time Logged · Project Budgets | per view |
| Clients list | Current · Archived | per view |
| Client detail | Tasks & Expenses · Keywords⁴ · ✎ Edit Client | per sub-view |
| Time | Log Entries · Running Timers¹ · My Timesheets² · Submitted Timesheets³ | `href === pathname` or regex `pattern` (`/\/timesheet(s\/[1-9]+)?$/i`, `/\/timesheets\/submitted/i`) |
| Quotes list | *(no tabs)* | — |
| Quote detail | Manage Quote · ✎ Edit Quote | `mode` |
| Invoices list | Invoices · Recurring | per view |
| Invoice detail | Manage Invoice · ✎ Edit Invoice | `mode` |
| Recurring invoice | Preview Invoice · Schedule · ✎ Edit Template | `mode` = show / edit_schedule / edit |

¹ only if `canViewAllTimeLogged()` ² only if `user.submits_timesheets` ³ only if `canManageAccount()` and `account.timesheet_approval`. ⁴ only if `user.installed_extension` (Chrome extension installed) *(from code)*.

Edit-tab guards *(from code)*:
- Invoice with payments → "Edit Invoice" tab is disabled with tooltip "You can't edit this invoice because payments have been added to it".
- Sent invoice/quote → clicking Edit opens a confirm: "You can edit this invoice, but you've already marked it as sent. Editing it will convert it back to a draft. Want to go ahead?" (Yes, edit it / No, don't edit).

### 3.2 Header action buttons per page

| Page | Actions (page-links row) |
|---|---|
| Reports | *(empty row)* |
| Clients | Add a Client (opens action-bar inline form) — or "Upgrade your account to add more clients" → `/settings/account/plan` when `allowed_clients` reached |
| Client detail (Tasks tab only) | New Project ▾ (Create from Preset Task Group / Create from Trello Board / Create from Basecamp Project / Create from Redbooth Project — unconnected integrations link to `/settings/account/integrations`) · New Quote · New Invoice ▾ (New Blank Invoice / Select Time & Expenses to Invoice). Quote/Invoice need `canManageInvoices`; disabled with tooltip for archived clients ("You can't create a quote for an archived client") |
| Time | Log Time Worked (opens modal form; Ctrl-click opens `/time/log`) |
| Edit time | Duplicate this log entry · Delete (confirm) |
| Quotes | New Quote (action-bar panel) |
| Quote detail | [Print · Get PDF · View Online] [Duplicate · Create Invoice] Delete |
| Invoices | New Invoice (action-bar panel) |
| Recurring list | Create a Recurring Invoice (modal) |
| Invoice detail | [Print · Get PDF · $ Payment Page] Billed Time · Duplicate · Delete |
| Invoice edit | ⊕ Add logged Time & Expenses to this invoice |
| Recurring detail | Delete · Enable/Disable Recurring Invoice |

### 3.3 Breadcrumbs

Breadcrumbs live in the H1: section link › record link › sub-page text, e.g.
`Clients › Acme Co`, `Invoices › INV 0042 › Edit`, `Invoices › INV 0042 › Add`,
`Recurring Invoices › recurring-003 › Edit Schedule`, `Clients › Archived`,
`Reports › Time Logged`, `Invoices › Recurring invoices`. Hover = 1px white underline.

### 3.4 Settings navigation

Server pages use a left column `#settings_navigation` (200px) and `#settings-page` (margin-left 240px).

| Heading | Links |
|---|---|
| Me | Profile · Password |
| Account | Preferences · Business Details · Paydirt Plan · Integrations · Preset Tasks · Account Data |
| Invoices & Quotes | Defaults · Online Payments · Line Item Creation · Inventory · Email Templates |
| Team | Team Members · Invite Member |
| Extensions | Keywords |

Current page = `li.current` (bold `#326478`, `rgba(0,0,0,.05)` bg).

### 3.5 `backbone_link`

Any `<a data-behaviour~="backbone_link">` is intercepted by the router (`handleClick`): unless a
modifier key or non-left button is used, it calls `router.navigate(pathname + search)` instead
of a full page load. Modifier-click falls through to the browser (new tab). Links without the
attribute (Settings, Log out, print/PDF) do full loads.

Navigation pipeline *(from code)*:
1. `dirtyManager.canNavigate()` — if the current form has unsaved changes it asks via modal confirm (resource names such as "this time log", "the invoice INV 0042", "the quote …").
2. Remove stray tooltips; reset `I18n.locale` to default (documents switch locale to the client's language while open).
3. Backbone navigate + Google Analytics `_trackPageview` (IP anonymised).
4. `render()`: unmount previous view (Backbone `teardown` or React unmount), render new into `#main`, add view's `bodyClassName`(s) to `<body>`, `window.scroll(0,0)`, update nav selection, set `<title>` to `Paydirt: {title}`.

Report-style pages (Time, Invoices, Quotes, Reports) keep filter state in the query string via
`history.pushState` (`range`, `start`, `end`, `type`, `by`, `client_id`, `currency_id`, `for`,
`id`, `user`, `billable`, `billed`, `invoice`, `target`) and restore it on `popstate`, so filtered
views are linkable (e.g. `/time?range=all-time&for=job&id=123&billed=false`).

---

## 4. Permissions

### 4.1 Permission flags

Stored per user in `user.permissions` (from `/data/all`), surfaced as methods on `Paydirt.Models.User`:

| Method | Flag | Effect on IA |
|---|---|---|
| `canManageAccount()` | `manage_account` | Submitted Timesheets routes/tab (with `timesheet_approval`); settings administration |
| `canManageInvoices()` | `manage_invoices` | `/quotes*`, `/invoices*`, `/recurring_invoices*` routes; New Quote/Invoice buttons on client page |
| `canViewAllTimeLogged()` | `view_all_time_logged` | `/time/running` + Running Timers tab; "Filter by team member" on Time |
| `canViewFinancialInformation()` | `view_financial_information` | `/clients*` routes; billable rates in time descriptions ("billable at $X/hr" vs just "billable"); billable/billed filters |
| `canLogTimeWithoutAssignment()` | `log_time_without_assignment` | Can track time on tasks they are not assigned to (task assignment feature) |
| *(account)* `timesheet_approval` | account setting | Enables Submitted Timesheets |
| *(user)* `submits_timesheets` | user setting | Shows My Timesheets tab |
| *(account)* `allowed_clients` | plan limit | `canAddClient()` = no limit or active clients < limit |
| *(account)* `features` | `{paypal, stripe, extra_users, assignment}` | plan feature flags |

Reports require **both** financial and invoice permissions. A user missing a permission who opens
a gated URL gets the 404 view ("That page could not be loaded … or you don't have permission to
access it").

### 4.2 Route visibility matrix

| Route group | Everyone | +view_all_time | +financial | +invoices | +financial & invoices | +manage_account & approval on |
|---|---|---|---|---|---|---|
| Time log/new/edit/duplicate, My Timesheets | ✔ | | | | | |
| Running timers | | ✔ | | | | |
| Clients | | | ✔ | | | |
| Quotes, Invoices, Recurring | | | | ✔ | | |
| Reports | | | | | ✔ | |
| Submitted timesheets | | | | | | ✔ |

API access requires full permissions (403 otherwise) — see [08](08-data-model-and-api.md).

---

## 5. Global behaviours

| Behaviour | Detail |
|---|---|
| Bootstrap | Shell page runs `System.import('./es6/app')` then `GET /data/all` → `Paydirt.app_initialize(data)`: sets locales, currencies, account, users, current user, clients, Pusher subscription, moment week start (`first_day_of_week`), d3 week, mounts tracker, starts router. Fires `paydirt.initialized` DOM event and `postMessage('paydirt.initialized')` to parent (extension iframe) |
| Loading state | Router wraps handlers: `#middle .container.router-loading` → `opacity:.5`, pointer-events off, 0.2s fade, until the handler's promise settles. Lists use `.fade-in-when-loaded` (opacity transition 0.3s). Graph: `#graph.loading` dims SVG to 0.5 with spinner `icon-refresh icon-spin` |
| 404 | `Views.PageNotFound`: blue band "That page could not be loaded"; box: "Sorry - we can't find the page you're looking for, or you don't have permission to access it." + support email + "You might want to go back to the Time page." |
| Record-not-found | Show/edit routes for time, quotes, invoices, recurring invoices redirect to their list on fetch failure |
| AJAX errors | Global `ajaxError` (except tracker requests): `402` with `redirect_url` → hard redirect (plan/billing wall); `403/404/422/500` → `Flash.error(responseText)` |
| Flash / toasts | `#flash` slot fixed bottom-centre; types `notice/success` (green), `error/warning/trial` (orange), `deleted`; auto-hide after 10s. `blocking_error` variant opens a modal with ⚠ and "Okay". Server-rendered pages put flash HTML into `#flash` on load. Documents have an inline `#document-flash` |
| Unsaved-changes guard | `Paydirt.dirtyManager` marks forms dirty on change; navigation prompts via modal confirm |
| Confirmations | `data-confirm` / `data-confirm-text` / `data-cancel-text` attributes → fancybox modal confirm (`fancyConfirm`, promise-based `Utilities.modalConfirm`) |
| Onboarding tour | `?tour=` query param read at router init. Values: `setup-jobs` (client page: help add a task, highlight General work, introduce tracker), `saved-invoice` (invoices list → introduce invoice page), `send-demo-invoice` (invoice edit → introduce email / send by email), `send-invoice` & `setup-payments` (invoice show: introduce Send button / payment setup; skips steps if PayPal/Stripe already enabled). Implemented with Guiders.js overlays; `body.app.tour` hides some decorations |
| Real-time updates | Pusher (`new Pusher(key,{encrypted:true, authEndpoint:'/pusher/auth'})`), one private channel per account, event `data`. Payloads: `{client}` → merges into client list (amounts update live); `{block}` → Time list refetches if in range, Running Timers list adds/removes, tracker updates; client page projects refresh (throttled 10s) |
| i18n | 17 document locales (see [08 §5](08-data-model-and-api.md)). Locale applies to **documents only** (invoice/quote labels: From, To, Invoice, Quote, Tax Invoice, Date Issued, Payment Due, Description, Qty, Unit Price, Amount, Subtotal, Total, currency delimiter/separator). Set per client (`client.locale`), overridable per document (`document.locale`). UI chrome is English only. `I18n.fallbacks = true` |
| Multi-currency | Account primary currency + per-client currency (53 currencies). All money shown with sign + grey ISO code (e.g. `$1,234.00 USD`). Lists that mix currencies show one totals row **per currency** (e.g. "Total (USD)", "Total (AUD)"). Changing a client's currency changes it for that client's invoices, tasks, expenses and time logs |
| Dates & times | Default display format `MMM D, YYYY`; ISO `YYYY-MM-DD` on the wire; time format `h:mma` (e.g. `9:00am`); durations `H:MM`; hours decimal 2dp; week start from account |
| Analytics | Google Analytics `_gaq` page views; internal event tracking `POST /eventy/record` |
| Modals | fancybox (`$.fancybox`), content often fetched from a server URL (move project, import preset tasks, compose email, PayPal/Stripe settings) |
| Tooltips | tipsy (`data-behaviour="tooltip"`, `data-tooltip-gravity`) |
| Chrome extension | Same app inside an iframe (`body.extension`, `ExtensionRouter`); keywords drive "work signals" suggestions |

---

## 6. Screenshot references

- `screenshots/03-reports-overview.jpg` — full frame: nav, blue band with tabs, beige body, footer, tracker.
- `screenshots/07-client-show.jpg` — breadcrumb, split buttons in page-links, 3 tabs incl. icon tab.
- `screenshots/15-invoice-show.jpg`, `16-invoice-edit.jpg` — document pages (wider container, joined action group).
- `screenshots/20-settings-quote-invoice-defaults.jpg` — settings layout without blue band.
- `screenshots/39-time-log-filters-and-entry-menu.jpg` — Time tabs, filter row, popover.

---

## 7. Notes for our version

- Permission gating is invisible: top-nav items stay visible and gated routes silently 404. Hide or explain unavailable sections instead.
- Two navigation systems (blue band + tabs for app, left nav for settings) and two render stacks; a single shell with consistent page header would simplify.
- The always-on 325px tracker eats horizontal space (min-width 1050px, 1245px on invoices); consider a collapsible rail and a responsive layout.
- Query-string filter state is a strength — keep every list/report linkable.
- Document locale vs UI locale is a good split; keep per-client language and currency, but make the effect of changing a client's currency on historic records explicit.
