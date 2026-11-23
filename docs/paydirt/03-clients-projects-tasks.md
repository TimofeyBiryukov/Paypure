# 03 — Clients, projects, tasks, expenses & keywords

Paydirt's **client** is the root of everything billable. A client holds **projects**. Each project
holds **tasks** (called *jobs* in the API and code) and **expenses**. Time logs are recorded
against tasks (see [04 — Time tracking](04-time-tracking.md)). Invoices and quotes belong to the
client (see [05 — Invoices & quotes](05-invoices-quotes.md)).

```
Account ─┬─ Client (currency, hourly rate, language, invoice prefix, badge)
         │    ├─ Work signals ("Keywords") — used by the Chrome extension
         │    ├─ Project (name, optional project hourly rate, completed flag, integration link)
         │    │    ├─ Task / job (name, price type + price, estimate, position, completed, assignees)
         │    │    │    └─ Time logs (blocks)
         │    │    └─ Expense (name, qty × each)
         │    ├─ Quotes
         │    └─ Invoices
         └─ Preset task groups (default_job_groups) → preset tasks (default_jobs)
```

Placeholders below ("Acme Co", "$1,234.00", …) replace real captured data.

---

## 1. Clients list — `/clients` and `/clients/archived`

### Purpose
All clients with their money position, one row per client and a totals row per currency.

### Route & entry points
| Route | Router handler | Collection shown | Page title |
|---|---|---|---|
| `/clients` | `clientsIndex` | `Paydirt.clients.active()` (`active: true`) | "Clients" |
| `/clients/archived` | `clientsArchived` | `Paydirt.clients.inactive()` (`active: false`) | "Archived Clients" |

You reach it from the top nav **Clients** tab. Each row links to `/clients/:id`.
The router only registers the `clients*` routes when `user.canViewFinancialInformation()` is true
*(from code)*. Users without that permission get no Clients section at all.

### Layout
- **Page head (blue band):** H1 "Clients". On the archived tab it is a breadcrumb: "Clients › Archived".
- **Page links:** **Add a Client** button. When the plan's client limit is reached it becomes the
  link **"Upgrade your account to add more clients"** → `/settings/account/plan` *(from code;
  `account.canAddClient()` = no `allowed_clients` limit, or `allowed_clients` > number of active clients)*.
- **Inline "New Client" action bar.** It is hidden and slides down (`slideToggle`) when you click
  Add a Client, and the input gets focus:
  | Element | Type | Notes |
  |---|---|---|
  | Heading "New Client" | h4 | |
  | Business name | text, placeholder "Business name" | required (`data-validates-presence`); Enter = Add Client |
  | **Add Client** | link-button | POSTs the client with only `business_name`, adds it to the global collection, goes to `/clients/:id`, shows a flash |
  | "or" **Add and edit details** | link-button | Same POST, then goes to `/clients/:id/edit` |
  The full form is also at `/clients/new` (§4).
- **Tabs (right side of the head):** **Current** | **Archived**. The tab whose URL matches the path is highlighted.
- **Body:** a sortable, searchable table (`div.report > table[data-behaviour="sortable searchable"]`).
- The persistent tracker sidebar is on the right (see 04).

### Table columns
| Column | Header behaviour | Cell content | Sort value |
|---|---|---|---|
| (client) | The header holds the **search box**: magnifier icon, input "Search for a client...", and an × clear link that shows only when there is text | Client badge (logo or coloured monogram) + business name, a link | business_name |
| Unbilled | Click to sort, numeric, desc first | `$1,234.00 USD` (amount in the client's currency, plus the grey ISO code), or grey "–" when zero | `amount_unbilled` |
| Owing | same | same | `amount_owing` |
| Overdue | same | same | `amount_overdue` |
| Quoted | same | same | `amount_quoted` |
| Invoiced | same | same | `amount_invoiced` |

- The whole row is clickable (`showClient`) and goes to `/clients/:id`.
- Default order is alphabetical by `business_name`, case-insensitive (collection comparator). The
  sorting library is `stupidtable`.
- **Footer totals, one `<tfoot>` per currency:** clients are grouped by `currency_id`. Each group
  gets a row "Total (USD)" with the sum of each column in that currency (grey "–" when zero).
  Currencies are never converted or mixed. A two-currency account shows two total rows (see
  screenshot 06).

### Search
- Filters client-side on every keyup. It is a case-insensitive regex (escaped) on the row's
  `data-search-text` (= business name). Non-matching rows are hidden.
- While a search is active **all totals footers are hidden**. Clear (×) empties the input,
  refocuses it and shows the totals again.

### States
| State | What shows |
|---|---|
| Loading | The list view fetches `GET /clients?active=true|false` on init. Each row shows the badge + name, and one cell spanning 5 columns with a spinner and "loading...". Money cells then fade in (`.fade-in-when-loaded` → `.loaded`). |
| Load error | Flash error "Error loading client data". |
| Empty (current) | Box: "You haven't added any of your clients to Paydirt yet. Want to [add your first client](/clients/new)?" |
| Empty (archived) | "You haven't archived any clients yet. Archive a client if you are no longer working for them." |

### Data & computation
- `amount_unbilled`: value of unbilled time plus unbilled expenses (computed by the server).
- `amount_owing`: unpaid balance of sent invoices. `amount_overdue`: the part of that balance that is past due.
- `amount_quoted`: total of open quotes *(unverified semantics; captured data showed "–" everywhere)*.
- `amount_invoiced`: lifetime invoiced total.
- The client attributes are typed as `Money` objects, and `.zero()` decides whether to show "–".

### Screenshots
`screenshots/06-clients-list.jpg`

---

## 2. Client page — `/clients/:id` ("Tasks & Expenses")

### Purpose
The working hub for one client: money summary, then every project with its tasks and expenses.
This is where tasks are created, priced, reordered and completed.

### Route & loading
- `clientsShow(id)` → `GET /clients/:id` returns `{client, projects}`. Projects (with nested jobs
  and expenses) go into a Redux store. The client model is merged into the global `Paydirt.clients`.
- The page is a Backbone `Clients.Show` shell (header, tabs) with the subview `Clients.Work`
  (summary row + a React mount `.react-projects-target`).
- `?tour=setup-jobs` starts an onboarding guider tour: "Creating tasks and tracking time" → "Create a
  task for Acme Co" (explains tasks with examples: "Web Development at $50 per hour", "Logo Design
  for $1200 total", "Consulting at Each user's own hourly rate") → points at the Add button →
  task name → price select → the tracker → "Draft an invoice" *(from code)*.

### Layout
1. **Breadcrumb H1:** "Clients › Acme Co" (both parts are links).
2. **Action buttons (left).** These show only on the Tasks & Expenses tab (`currentPath === /clients/:id`):
   - **New Project** split button + caret dropdown (§2.1)
   - **New Quote** (needs `canManageInvoices`)
   - **New Invoice** split button + caret dropdown (needs `canManageInvoices`)
3. **Tabs (right):** **Tasks & Expenses** | **Keywords** (only if `user.installed_extension`) |
   **✎ Edit Client**.
4. **Summary bar**: a white box with 5 columns. Each heading is a link:
   | Heading | Value | Link target |
   |---|---|---|
   | UNBILLED | `amount_unbilled` + currency code | `/time?range=all-time&for=client&id=:id&billed=false` |
   | OWING | `amount_owing` | `/invoices?type=current&client_id=:id` |
   | OVERDUE | `amount_overdue` | `/invoices?type=overdue&client_id=:id` |
   | QUOTES | `amount_quoted` | `/quotes?type=all&client_id=:id` |
   | INVOICES | `amount_invoiced` | `/invoices?type=all&client_id=:id` |
   Values are formatted with the client currency sign, e.g. "$1,234.00 USD". Zero shows as "$0 USD" here, not "–".
5. **Project list:** one block per project, separated by a heavy horizontal rule (§2.3).

Empty state with no projects: "You don't have any projects for Acme Co. [Add a project] to start
tracking time and logging expenses for this client."

While a task is being dragged, an overlay message shows: "Drag this task to a different position or project."

### 2.1 Header menus

**New Project** (main button) → dispatches `Projects.create({client_id})`. A new unsaved project
block appears at the **top** of the list in edit mode (§3). Nothing is persisted until Save.

**New Project ▾ dropdown** (screenshot 25):
| Item | Behaviour |
|---|---|
| Create from Preset Task Group | Opens a server-rendered modal `GET /default_job_groups/import_project?client_id=:id`. You pick a preset task group, and a new project is created with that group's tasks. When the modal closes, the page refetches `GET /clients/:id` and re-stores projects and client. *(The modal markup was not captured.)* |
| — divider — | |
| Create from Trello Board | Not connected (`account.trello_connected` false): plain link to `/settings/account/integrations`. Connected: opens the **Import modal** (below) with `fetchURL /integrations/trello/fetch_open_boards`, `createURL /integrations/trello/create_project_from_board`, id attr `shortLink`, job term "card". |
| Create from Basecamp Project | Same pattern, gated on `basecamp_connected`; fetch `/integrations/basecamp/fetch_current_projects`, create `/integrations/basecamp/create_project_from_basecamp_project`, term "todo" |
| Create from Redbooth Project | Same pattern, gated on `redbooth_connected`; fetch `/integrations/redbooth/fetch_current_projects`, create `/integrations/redbooth/create_project_from_redbooth_project`, term "task" |

**Import modal** (`Projects.Import`, fancybox, 450px wide) *(from code)*:
- Title "Import a Trello board" (or "Import this …" when opened from the extension).
- On open: progress notice "Retrieving your projects..." with a spinner, then loads the remote list.
- Fields:
  | Field | Shown when | Notes |
  |---|---|---|
  | "Which Paydirt client does this Trello board belong to?" select2 (placeholder "Choose a client...") | no client preselected (the extension flow) | Options: "Add a new client...", then all clients. Choosing "new" reveals **Client name** text input. Required: if empty, it gets a red outline and the button shakes. |
  | "Trello board to import" select2 | no project preselected | Remote boards/projects |
  | "Show advanced options" link | always | Reveals the sync options below |
- **Sync options** (`projects/sync_options_fields`, also used by the per-project "Options" modal):
  | Question | Options | Default |
  |---|---|---|
  | Import all cards? | **Yes**, import all of the cards each time I sync / **No**, only import the cards I log time for in Paydirt | `import_jobs: false` |
  | Keep completeness in sync? | **Yes**, sync tasks' completeness from the Trello board / **No**, don't mark Paydirt tasks as complete | `accept_completeness: true` |
  | By default, how should imported tasks be billed? ("Select a default pricing for imported tasks. You can change the pricing of individual tasks if you need to.") | At the client's hourly rate / At the project's hourly rate / At each user's own hourly rate / Time is not billable | `account.default_price_type` |
- Actions: **Import Trello board** (it becomes "Importing Trello board... ⟳" while disabled) or **cancel**.
  On success it shows "done!", adds the project to the client, and auto-closes after 2.5 s. On error
  the server's responseText shows in a red error box.

**New Quote** → `POST /quotes {client_id}` → flash → `/quotes/:id/edit`.
Archived client: disabled button with tooltip "You can't create a quote for an archived client".

**New Invoice** (main) / **New Blank Invoice** → `POST /invoices {client_id}` → flash → `/invoices/:id/edit`.
**Select Time & Expenses to Invoice** → `/clients/:id/invoices/new`. This is the
"invoice unbilled work" builder (date range "Include all unbilled time" / "Only time logged between …
and …", per-task "Bill … in this invoice", line-item creation options, a live preview, then "Draft this invoice").
It is documented in 05. Archived client: a single disabled "New Invoice" with tooltip "You can't
create an invoice for an archived client". (Screenshot 26.)

### 2.2 Ordering
- **Projects:** unsaved new projects first, then by `created_at` **newest first** (`entities/projects.comparator`).
- **Tasks within a project:** unsaved first, then current before completed, then by `position` ascending.

### 2.3 Project block

```
Project name                                                      [▾]
Project rate: $90 / hour ▸ $1,234.00 unbilled ▸ Draft an invoice ▸ Linked to a Trello board ▸ Trello Options ▸ Sync Now
┌ Tasks ─────────────────────── [Add|▾] ┐  ┌ Expenses ──────────── [Add] ┐
│ task rows …                            │  │ expense rows …               │
│ Show all 25 current tasks · Show 12 completed tasks │  │                 │
│                 Total │ 12.50 hours worked │ $0 unbilled │ [estimate bar] │  Total │ $0 unbilled │
└────────────────────────────────────────┘  └──────────────────────────────┘
```

- **Header:** H1 project name. Clicking it toggles **Hide/Show details** (collapses the contents).
  Completed projects show "✓ Completed" after the name and **start collapsed**.
- **Status line** (`projects/status`). Parts are joined with ▸ carets:
  1. "Project rate: $X / hour", only if `hourly_rate > 0`.
  2. If unbilled value (`jobs_unbilled_value + expenses_unbilled_value`) > 0: "**$X unbilled** ▸ [Draft an invoice]"
     (→ `/clients/:id/invoices/new?for=:projectId`). Otherwise **"Fully billed"**.
  3. Integration: "Linked to a [Trello board] ▸ [Trello Options] ▸ [Sync Now]" (Basecamp: "project", Redbooth: "project").
     - *Options* opens the Sync options modal ("Trello options for this project", **Save Options** / cancel).
     - *Sync Now* opens a confirm "Here's what will happen" with bullets that depend on the settings:
       "New cards on the Trello board will be imported as tasks." / "Cards that are marked as completed in
       Trello will be marked as completed in Paydirt…" / "Cards that aren't marked as completed … will be
       marked as current in Paydirt." / "Your Trello board won't be touched." + "Go ahead and sync?".
       Buttons: "Never mind" / "Sync with Trello now". Then a status modal "Syncing with Trello board..." /
       "Please wait while we fetch your cards from Trello." Success: "All done!" + a server message.
       Failure: "Something went wrong." with a support email line.
- **Two columns:** Tasks (left, wider), Expenses (right).

#### Project options menu (▾, top-right of the block; screenshot 27)
| Item | Icon | Shown | Behaviour |
|---|---|---|---|
| Edit | pencil | always | Header turns into the inline edit form (§3) with the name selected |
| Draft an invoice | file | always | Link → `/clients/:id/invoices/new?for=:projectId` (invoice builder limited to this project) |
| Add hourly rate | "$" glyph | only when the project has **no** hourly rate | Opens the edit form with the hourly field shown and focused |
| Mark complete / Mark current | check | always (label toggles) | Saves `completed = !completed`. Completed projects collapse and show "✓ Completed". *(The effect on tasks is server-side and unverified.)* |
| Move project | move | always | Modal from server: `GET /clients/:id/projects/:pid/move`. It moves the project (and its tasks, expenses and time) to another client. *(Modal markup not captured.)* |
| Hide details / Show details | angle-up/down | always | Collapses or expands tasks and expenses. Local UI state only, not persisted. |
| — divider — | | | |
| Delete | remove-sign | always | Confirm: "Deleting this project will also remove all tasks, expenses, and time logged towards it. Are you sure you want to do that?" — "No, don't delete it" / "Yes, delete project". An unsaved new project is just discarded. |

#### Tasks section
- Section header "Tasks" + **Add** split button (green):
  - **Add** → creates a new unsaved task at the top of the list in edit mode (§2.4).
  - **▾ Add from Preset Tasks** → server modal `GET /default_job_groups/import?project_id=:pid`. You pick
    preset tasks to copy into this project *(modal not captured)*. Screenshot 29.
- **Task row (show mode):**
  | Part | Content |
  |---|---|
  | Name | H3 task name |
  | Metrics line | ⏱ **10.25** hrs logged (→ `/time?range=all-time&for=job&id=:jid`) · **0.00** hrs unbilled (→ same + `&billed=false`) · **$0** unbilled · "Completed" (if completed). Zero metrics are greyed (`.zero`). Hours = `duration` seconds → hours with 2 decimals. |
  | Price pill (right) | See the rate-type table: e.g. "Client rate → $80 per hour", "$1,234.00 fixed price", "Not billable", "User hourly rate" |
  | Assignees | "👤 Assigned Jane Doe, John Roe". Click to edit with a select2 multi-select and a **done** button (saves `assigned_user_ids` on close). Shown when the task is current and has assignees, or after "Assign users". |
  | Estimate bar | If `estimate` is set: a progress bar "62.50% of 40.00 hours". Classes: `warning` when > 80 %, `complete` when ≥ 100 % (capped at 100 % wide). |
  | ▾ menu | §2.5 |
- **Show more controls** (under the list):
  - Only the first **20** current tasks are shown. If there are more: "Show all N current tasks".
  - If `completed_jobs_count > 0`: "Show 12 completed tasks" / "Hide 12 completed tasks" (pluralised:
    "one completed task"). The first time, completed tasks are lazy-fetched from
    `GET /clients/:cid/projects/:pid?include_completed_jobs=true` or `/jobs/completed?project_id=`,
    and "Loading…" shows meanwhile. Completed tasks render greyed (`.job-box.completed`).
  - Rendering is also windowed: 60 rows at first, +20 when you scroll near the bottom.
- **Empty states:** "Add a task to log time for {Project name}". If every task is complete:
  "All the tasks in this project are completed!"
- **Tasks summary** (when any tasks show): right-aligned "Total" | **{hours} hours worked** (project
  `duration`) | **${x} unbilled** (`jobs_unbilled_value`). If the project `estimate` (the sum of the
  task estimates) > 0, a project-level estimate progress bar shows too (`estimate_progress` vs `estimate`).
  **This is Paydirt's only "budget": time estimates in hours.** There is no money budget field on
  projects. The *Reports → Project Budgets* page (06) reports on these estimates.

#### Drag to reorder / move (react-dnd, HTML5 backend)
- Any current or completed task row can be dragged (not while editing, and not while another move is being previewed).
- Hovering over another task (throttled to 50 ms) previews the drop *before* or *after* it, depending
  on which half of the row the pointer is over. Hovering over an empty project's empty state
  previews appending to that project.
- **Constraint:** you can only drop next to a task with the same `completed` state, so current and
  completed tasks never interleave.
- On drag end the task is saved with `project_id` = target project and `move_before_job_id` or
  `move_after_job_id` = neighbour id. The server then recomputes `position`. Moving to another
  project of the **same client** is supported. Moving to another client is not (use Move project).

#### Expenses section
- Header "Expenses" + **Add** (green). Add creates a new unsaved expense in edit mode.
- **Edit form** (screenshot 32):
  | Field | Type | Default | Validation |
  |---|---|---|---|
  | Name | text, placeholder "Name" | "" | required |
  | qty | number input (max 2 decimals), label "qty" | 1 | required |
  | each | price input with currency sign, label "each" | $0 | required, max 2 decimals |
  | cancel / **Save** | | Save is disabled until something changes | |
- **Show row:** H3 name, ▾ menu (**Edit**, —, **Delete**), then three right-aligned figures:
  `{qty}` qty · `${value}` each · `${qty×value}` total.
- Delete confirm: "Are you sure you want to remove this expense?" — "No, don't delete it" / "Yes, delete this expense".
- Empty: "No expenses logged." When there are expenses, a summary shows "Total | $X unbilled"
  (`project.expenses_unbilled_value`).
- Expenses have no date, category, receipt or markup fields in this UI. They become invoice line
  items via the invoice builder ("Select Time & Expenses").

### 2.4 Task create/edit form (inline; screenshots 30, 31)

| Element | Type | Default | Notes |
|---|---|---|---|
| Task Name | text, placeholder "Task Name", autofocus/select | "" | required |
| + Add a time estimate | link | (no estimate) | Shows "Estimate [__] hours ⊗". Number ≥ 0, stored as **seconds** (`hours × 3600`). ⊗ "Remove estimate" sets it to null. Saving an estimate ≤ 0 stores null. |
| Price input | currency input `$__` | | **Shown only** for *Custom hourly rate* and *Fixed price* |
| Price type | dropdown button showing the current choice, e.g. "Client rate ($80 /hr) ▾" | see below | Each option shows an explanation |
| Save | submit | **disabled** until the task differs from the original | |
| "or cancel" | link | | Cancelling a new task discards it |

**Rate types** (`constants/price-type`; the API docs list only 0–2):

| `price_type` | Dropdown label | Explanation text in the menu | Pill when shown | Rate used for time logged |
|---|---|---|---|---|
| 3 `CLIENT_HOURLY_RATE` | Client rate ($80 /hr) | Time logged is billable at **this client's hourly rate**. | "Client rate → $80 per hour" | client.hourly_rate (live) |
| 5 `PROJECT_HOURLY_RATE` | Project rate ($0 /hr) | Time logged is billable at **this project's hourly rate**. | "Project rate → $90 per hour" | project.hourly_rate |
| 0 `PER_HOUR` | Custom hourly rate (pill: "Per hour") | Time logged is billable at **the hourly rate you choose** for this particular task. | "$75 per hour" | task.price |
| 2 `PER_USER` | User hourly rate | Time logged is billable at each **user's own hourly rate**. | "User hourly rate" | each team member's rate (set in Team settings) |
| 1 `FIXED_PRICE` | Fixed price | A **fixed dollar amount** for the task, regardless of the amount of time logged. Time logged is **not billable**. | "$1,234.00 fixed price" | none: task.price is billed once (`unbilled_fixed_value` until invoiced) |
| 4 `NOT_BILLABLE` | Not billable | Time logged is **not billable**. | "Not billable" | none |

**Defaults for a new task** *(from code)*: `price_type` = Project rate if the project has an hourly
rate > 0, otherwise `account.default_price_type` (default 3 = Client rate). `price` = `account.default_price`.

**Re-rating existing time on save** (`entities/jobs/update_blocks_modal`). Only when an existing task has
`unbilled_duration > 0`, a confirm dialog asks whether to rewrite *unbilled* time logs. Buttons:
"Don't update time logs" / "Update my unbilled time logs". Yes → saves with `update_blocks: true`.
| Change | Heading / gist |
|---|---|
| Custom hourly price changed | "Do you want to update the hourly rate of existing time logs?" — "You're changing the hourly rate for this task from $80 to $90… update all unbilled time logs with the old rate…" |
| → Custom hourly | "…update all unbilled time logs to this task's hourly rate of $X per hour?" |
| → Fixed price | "Do you want to mark existing time logs as not billable?" |
| → User hourly rate | "…update all unbilled time logs to the hourly rate of the team member that logged that time? …won't mark any unbillable time logs as billable." |
| → Client rate | "…update … to the client's hourly rate of $X per hour?" |
| → Not billable | "Do you want to mark existing time logs as 'Not billable'?" |
| → Project rate | "…update … to the project's rate of $X per hour?" |
Every message ends with "This won't update any time logs that have already been billed."

### 2.5 Task options menu (▾ on each task; screenshot 28)
| Item | Icon | Shown | Behaviour |
|---|---|---|---|
| Edit | pencil | always | Inline edit form (§2.4) |
| Add a time log | plus | current tasks | Opens the time-log modal form (`Blocks.ModalForm`) prefilled with `job_id` (see 04) |
| Start a timer | clock | current tasks | Opens the tracker sidebar and starts a timer on this task |
| Mark complete | check | current tasks | Saves `completed: true`. The task disappears from the current list (it moves into the "Show N completed tasks" set). |
| Mark current | check | completed tasks (replaces the 3 items above) | Saves `completed: false` |
| Assign users | user | only if `account.features.assignment` | Opens the assignee picker inline |
| — divider — + View Trello Card / View Basecamp Todo / View Redbooth Task | eye | only for imported tasks | Opens the external item in a new tab |
| — divider — | | | |
| Delete | remove-sign | always | Confirm: "Are you sure you want to delete this task? This will also remove all time logged towards it." — "No, don't delete it" / "Yes, delete this task" |

### Permissions / gating (client page)
- The whole section needs `view_financial_information`.
- New Quote / New Invoice need `canManageInvoices`, and are disabled with a tooltip for archived clients.
- Keywords tab needs `user.installed_extension`.
- Assign users needs the account feature `assignment` (team plans).
- Trello/Basecamp/Redbooth import needs the integration connected, otherwise the item links to Integrations settings.

### Screenshots
`07-client-show.jpg`, `25-client-menu-new-project.png`, `26-client-menu-new-invoice.png`,
`27-client-menu-project-options.png`, `28-client-menu-task-options.png`, `29-client-menu-task-add.png`,
`30-client-add-task-form.jpg`, `31-client-task-rate-types.png`, `32-client-add-expense-form.jpg`

---

## 3. Project create / edit (inline)

There is no separate project page or modal. New Project and Edit both turn the project header into an
inline form (`projects/edit_details`):

| Element | Type | Default | Notes |
|---|---|---|---|
| Project name | text, placeholder "Project name" | "" | Selected on open. No client-side required check. |
| Hourly rate | currency input + " per hour" + (?) tooltip "This hourly rate applies to tasks with "project rate" selected as their price." + ⊗ "Remove this project's hourly rate" | 0 | Shown if the project already has a rate, or if opened via "Add hourly rate". ⊗ sets it to 0 and hides the field. |
| cancel / **Save** | | | Cancelling a *new* project removes the block |

- While the project is unsaved, its Tasks/Expenses contents are not rendered.
- **On save of a rate change:** if any task in the project uses *Project rate*, a confirm asks "Do you want
  to update the hourly rate of existing time logs?" ("You're changing the hourly rate for this project
  from $80 to $90… update all unbilled time logs for tasks billed at the project's old hourly rate…").
  Yes → `update_blocks: true`.
- **Model defaults** (`Paydirt.Models.Project`): `completed false, name "", import_jobs false,
  accept_completeness true, default_price_type 3, jobs_unbilled_value 0, expenses_unbilled_value 0,
  completed_jobs_count 0, duration 0, estimate null, hourly_rate 0`.
- **No budget / deadline / description / status fields exist.** The "budget" is the sum of task time estimates (§2.3).

---

## 4. New / edit client form — `/clients/new`, `/clients/:id/edit`

### Route & layout
- `/clients/new`: page H1 "New Client". Right column: big **Save Client** button, "or Cancel" (→ `/clients`). Page title "Add a Client".
- `/clients/:id/edit`: inside the client shell (breadcrumb, tabs with **Edit Client** selected, no
  action buttons). Right column (sticky `.follow`): **Save changes**, "or Cancel" (→ `/clients/:id`),
  then **Archive Client** (blue) or **Un-archive Client**, then **Delete Client** (red). Title "Edit Acme Co".
- The form validates client-side (`data-behaviour="validate"`, fields marked `data-validates-presence`).

### Box 1 — Client Details
| Label | Field id | Type | Default | Help text | Validation |
|---|---|---|---|---|---|
| Business name | `business_name` | text (autofocus on new) | "" | — | required. On change it auto-fills Monogram (first 2 chars) if empty. On blur it auto-fills the prefix (see below). |
| Contact name | `billing_contact_name` | text | "" | "Who do you address your invoices to?" | — |
| Email address | `billing_email_address` | text | "" | "What email address do you send your invoices to? You can add multiple email addresses here, separated by commas." | (none client-side) |
| Address & details | `billing_address` | textarea, 6 rows, 250 px, placeholder "123 Main Street / City, State" | "" | "This information is displayed on invoices. You may add other information (like tax IDs) here, too." | — |

### Box 2 — Billing Preferences
| Label | Field id | Type | Default | Help text |
|---|---|---|---|---|
| Billing currency | `currency_id` | select2 with search, 53 currencies, format "United States Dollars (USD, $)" (incl. Bitcoin BTC Ƀ, Unidad de Fomento UF) | account currency | "Changing this currency will also change the currency for all existing invoices, tasks, expenses, and time logs for this client." (**relabels without converting**) |
| Hourly rate | `hourly_rate` | currency input ("$80") | $0 | "What's your regular hourly rate for this client? You can change this on individual tasks if you need to." |
| Invoice language | `locale` | select2: Czech, Dansk, Deutsch, English, Español, Fārsi, Français, Magyar, Íslenska, Italiano, Nederlands, Norsk, Polski, Português Brasileiro, Romanian, Svenska, Türkçe (17) | English (`en`) | "Changing the invoice language will also change the language for all existing invoices for this client. Want to see your language here? Drop us a line and we'll get onto it." |
| Invoice numbering | `shortname_type` select + `shortname` text (5 chars wide) | select2 options: **New prefix** ("Create a new prefix"); **No prefix** "(3 other clients use no prefix)"; then each existing prefix in use, e.g. "**abc** (2 clients use this prefix)" | New client: "New prefix" if the account setting `use_client_shortnames`, else "No prefix" | "Invoice numbers are generated sequentially per prefix. Eg: abc-001, abc-002 & xyz-001, xyz-002. If you prefer plain invoices numbers (001, 002, 003) choose "No prefix". [Learn more]" |
| Invoicing threshold | `invoicing_threshold` | currency input | $1,000 | "Remind me to invoice this client when I exceed this amount of unbilled work." |

Prefix behaviour: choosing "New prefix" shows the text box and auto-suggests the first 3 letters of the
business name, lowercased. It appends 1, 2, … until the prefix is unique among clients. Choosing an
existing prefix shares that number sequence with the other clients that use it.

### Box 3 — Paydirt Identity
Intro: "Paydirt uses a badge for each client so that you spot them at a glance. Upload your client's logo, or create a simple monogram."
| Label | Field | Type | Default | Notes |
|---|---|---|---|---|
| Color | `color` | minicolors hex picker (7 chars) | random from `#66A1D2 #780CE8 #E88A10 #39D0B9 #FF3331 #5ED242 #2F2F2F #E2507C #5C2751 #F46036` | required. Live-updates the preview. |
| (radio) Upload an image / Use a monogram | `badge_type` | radio | monogram (logo if the client has `logo_path`) | Toggles the two inputs below |
| Logo | `logo` | file, accept png/jpeg | — | "PNG or JPG less than 50KB. Images are resized and cropped square." Error "The selected image was larger than 50KB. Please choose a smaller image." (**the code actually rejects files > 100 KB**). Sent as a data-URL. |
| Monogram | `monogram` | text, maxlength 2 | first 2 chars of the name | required |
| Preview | `.demo .badge.big` | | | Live badge preview |

### Save behaviour
- Payload: `business_name, billing_contact_name, billing_email_address, billing_address, shortname,
  hourly_rate, color, currency_id, locale, invoicing_threshold, logo?, monogram, new_badge_type, update_blocks`.
- **If the hourly rate changed** (edit), a confirm first asks: "Do you want to update the hourly rate of existing time
  logs?" — "You're changing the hourly rate for this client from $80 to $90. Do you want to also
  update all unbilled time logs that were logged at the client's hourly rate to the new rate of $90
  per hour? This won't update any time logs that you've already billed." — "Don't update time logs" /
  "Update my unbilled time logs".
- Success → client added or merged into the global list, navigate to `/clients/:id`, server flash notice.
- Cancel on New destroys the unsaved model.

### Archive / un-archive / delete
| Action | Confirm text | Buttons | Effect |
|---|---|---|---|
| Archive Client | "Are you sure you want to move this client to your list of archived clients, and mark all of their tasks as finished?" | "No, don't archive client" / "Yes, archive this client" | `active: false` and all tasks marked complete (server). Navigates to `/clients`. Flash "Moved Acme Co to your list of archived clients". |
| Un-archive Client | "Are you sure you want to move this client to your list of current clients?" | "No, don't move client" / "Yes, move client" | `active: true`. Flash "Moved Acme Co to your list of current clients". Tasks stay completed *(unverified)*. |
| Delete Client | "Deleting this client will also remove all tasks, expenses, quotes, invoices and time logs associated with it. Are you sure you want to delete it?" | "No, don't delete it" / "Yes, delete this client" | `DELETE /clients/:id`. Navigates to `/clients` with a "deleted" flash. Hard delete, cascades. |

Archived clients cannot get new quotes or invoices (buttons disabled). Archived clients do not count
toward the plan's `allowed_clients`.

### Screenshots
`08-client-edit.jpg`, `09-client-new.jpg`

---

## 5. Keywords — `/clients/:id/keywords`

### Purpose
"Keywords" (model `WorkSignal`, endpoint `/work_signals`) feed the **Paydirt Chrome extension**.
The extension scans the pages you visit for any client's keywords. When it finds one, it prompts you
to start a timer for that client. They do nothing inside the web app itself.

### Layout
- Client shell, **Keywords** tab selected. The tab only shows if the user has installed the extension.
- Left box: header **"Keywords for Acme Co"** + link **Add a keyword**.
  - Each keyword row: the text · "Test this keyword" (opens a Google search for the text in a new tab) · ✎ edit · × delete.
  - Inline form: one text input (`work_signal_text`) + "Cancel" or **Save**. Edit hides the row and shows the form after it.
  - Empty: "No keywords means no notifications!" / "You should [add your first keyword] for Acme Co."
- Right info well: **"What are keywords?"** — "Keywords allow the Paydirt browser extension to automatically
  determine who you're working for. It scans the pages you visit for your clients' keywords, and when it
  finds one, it prompts you to start a timer for the matching client." / "Each keyword is simply a unique
  word related to a client - like their business name, website address, or email address."
- Observed: the contact name and the email field were auto-created as keywords (server-side,
  probably on client create/update; *unverified*). Note that the comma-separated email string was stored as **one** keyword.
- Delete has no confirmation. It shows a "deleted" flash. Save shows a success flash and fires the
  `work_signal_created` body event (for the onboarding flow).

### Related: Settings → Extensions → Keywords (`/settings/extensions/keywords`)
A static help page: "The Paydirt Chrome Extension searches for keywords…". It lists recommended
keyword kinds with examples: **Web addresses** (`example.com`, `example.com/wp-admin/`,
`twitter.com/example`, `localhost/example/`), **Business names**, **People's names**,
**Email addresses** (full address or `@domain` suffix). It links to a video.

### Screenshot
`10-client-keywords.jpg`

---

## 6. Preset tasks (default job groups) — `/settings/account/default_tasks`

*(The SPA settings page was not rendered in the capture; this section is from code. See 07 for the settings chrome.)*

- Heading **Preset Tasks** + **Add Task Group**. Info: "You can quickly add commonly used tasks to your clients
  by defining them as presets. Task groups can be imported as a new project, or have their tasks imported
  into existing projects."
- **Task group:** a name (inline form "Group name", Save or cancel). Menu: Edit, Delete (confirm: "Deleting this
  task group will also remove all the preset tasks it contains. This won't affect projects that had these
  tasks added to them…" — "Yes, delete preset task group"). Plus the **Add Task** link.
- **Preset task:** "Task Name" + the same **PriceSelect** as real tasks (§2.4, in the account currency;
  default type 3 Client rate, price 0). Save is disabled while the name is blank. Pill shown, with
  "👤 Assigned …" names. Menu: Edit, **Assign User**, **Unassign User**, Delete ("Are you sure you want to
  delete this default task? This won't affect any projects that had this default task added to them.").
- **Assign/Unassign a Team Member** modal: pick a user (select2 with avatars). If the preset was already
  imported into clients, it lists them as checkboxes, all pre-checked: "This preset task has been imported
  into the following clients. In addition to updating the preset task, which clients' copies of this task
  should we assign this team member to?" → `PUT …/assign_user {user_id, client_ids}`.
- Used by: **New Project ▾ → Create from Preset Task Group** (new project from a group) and **Tasks Add ▾ →
  Add from Preset Tasks** (copy into an existing project). Copies are independent of the preset after import.
- Groups and tasks are sorted by `created_at` desc.

---

## 7. Data model (client-side models + public API)

### Client (`/clients`, API `/v1/clients`)
| Attribute | Type | Notes |
|---|---|---|
| id | int | |
| business_name | string | **required** (only required field, API and UI) |
| billing_contact_name | string | Invoices are addressed to this contact |
| billing_email_address | string | Comma-separated list allowed |
| billing_address | text | Printed on invoices |
| shortname | string | Invoice number prefix. "" = none. |
| hourly_rate | decimal (Money) | default 0 |
| currency_id | int | default = account currency |
| locale | string | default `en`. Invoice translation. |
| invoicing_threshold | decimal | default 1000. Above it the client is "ready to invoice". |
| active | bool | false = archived |
| color, monogram, logo_path | string | Badge. `new_badge_type` + `logo` (data URL) on write. |
| amount_unbilled / amount_owing / amount_overdue / amount_quoted / amount_invoiced | Money, read-only | Computed by the server |
| projects[], work_signals[] | nested | |
API: list/fetch/create/update/delete. Delete "Deletes … all projects, jobs, expenses, invoices, quotes, and time logs associated with it."

### Project (`/clients/:cid/projects`, API `/v1/projects`)
| Attribute | Type | Notes |
|---|---|---|
| id, client_id | int | |
| name | string | required (API) |
| completed | bool | |
| hourly_rate | Money | 0 = none. Used by tasks with price_type 5. |
| created_at | date | sort key (desc) |
| duration | seconds | total logged |
| estimate / estimate_progress | seconds | sum of task estimates / progress against them |
| jobs_unbilled_value, expenses_unbilled_value | Money | unbilled value = their sum |
| completed_jobs_count | int | drives "Show N completed tasks" |
| import_jobs, accept_completeness, default_price_type | sync settings | for linked projects |
| trello_board_id, basecamp_project_id, basecamp_account_id, basecamp_version, redbooth_project_id | integration links | |
| update_blocks | write-only flag | re-rate unbilled time |
| jobs[], expenses[] | nested | |
API: fields `id, client_id, name`. Create needs `client_id, name`, optional `completed`. Delete removes all jobs, expenses and time logs.

### Task / job (`/jobs`, API `/v1/jobs`)
| Attribute | Type | Notes |
|---|---|---|
| id, client_id, project_id | int | project_id "blank if the job is not part of a project" (legacy) |
| name | string | required |
| price_type | int | 0 Per hour (custom) · 1 Fixed price · 2 User hourly rate · 3 Client rate (default) · 4 Not billable · 5 Project rate |
| price | decimal | The hourly rate (type 0) or the fixed amount (type 1). Ignored otherwise. |
| estimate | int seconds / null | |
| completed | bool | |
| position | int | ordering. Write `move_before_job_id` / `move_after_job_id` to reposition. |
| duration, unbilled_duration | seconds | |
| unbilled_value, unbilled_hourly_value, unbilled_fixed_value | Money | fixed value stays unbilled until it is invoiced |
| estimate_progress | seconds | |
| amount_to_invoice | Money | used by the invoice builder |
| assigned_user_ids | int[] | team assignment |
| trello_card_id, basecamp_todo_id, redbooth_task_id | string | imported tasks |
| update_blocks | write-only flag | |
API create requires `project_id, name, price_type, price`.

### Expense (`/expenses`)
| Attribute | Type | Notes |
|---|---|---|
| id, project_id | int | |
| name | string | required |
| quantity | float | default 1, max 2 decimals in the UI |
| value | Money | unit price ("each") |
| total | Money | computed: quantity × value |
(Expenses are not in the public API.)

### WorkSignal (`/work_signals`) — `id, client_id, text`.
### DefaultJobGroup (`/default_job_groups`) — `id, name, created_at, default_jobs[]`.
### DefaultJob (`/default_job_groups/:gid/default_jobs`) — `id, default_job_group_id, name, price, price_type (default 3), assigned_user_ids, created_at`.

---

## 8. Notes for our version
- **Money "budget" is missing.** Paydirt only has hour estimates per task (summed per project). A real
  project budget (amount, hours, or both, with a burn-down) and project dates/status would fill a clear gap.
- **Rate model is powerful but buried.** Six price types behind a small dropdown, plus a re-rate dialog
  on every change. Consider a rate hierarchy (task → project → client → user) shown as "inherits from …",
  with one consistent "apply to unbilled time?" choice.
- **Currency change only relabels.** Changing the client currency silently relabels every existing
  amount without converting it. Lock it once anything is invoiced, or offer conversion.
- **Expenses are bare.** No date, receipt, category, tax or markup, and no billable/non-billable flag.
  They are worth extending. Keyword auto-creation from a comma-joined email string is a visible bug.
- **Small inconsistencies:** the logo limit says 50 KB but the code allows 100 KB. Search hides the
  totals instead of re-computing them. Showing completed tasks needs an extra fetch. Projects sort
  newest-first with no manual ordering. Tasks drag only within the same client.
