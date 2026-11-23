# 04 · Time tracking

Covers everything under the **Time** top-nav item: the time log list, the Log Time form (new, edit,
duplicate, modal), running timers, timesheets and their approval, the always-present **tracker
sidebar**, the Chrome extension and keywords, and real-time sync over Pusher.

Paydirt calls a time entry a **block** in code and API routes (`/time`, `Paydirt.Models.Block`) and a
**time log** or **log entry** in the UI and public API. A **task** in the UI is a **job** in code.

Conventions: *(from code)* means read from `app.js` and not seen in the UI. *(unverified)* means
inferred and uncertain.

---

## 0. Shared header for the Time section

All Time pages share a `PageHead` (blue band):

| Region | Content |
|---|---|
| Title (h1) | "Time" (log list), "Log Time" (new page), "Edit Time", "Duplicate a log entry", "Running Timers", "My Timesheets", "Submitted Timesheets", "Submitted Timesheet" |
| Page link (button, left) | **Log Time Worked**. A normal click opens the Log Time form in a **modal**. Ctrl-click follows the link to the full page `/time/log` *(from code)*. |
| Tabs (right) | **Log Entries** (`/time`, always shown) · **Running Timers** (`/time/running`, only if the user has `view_all_time_logged`) · **My Timesheets** (`/timesheets`, only if the user has `submits_timesheets`) · **Submitted Timesheets** (`/timesheets/submitted`, only if the user has `manage_account` and the account has `timesheet_approval` on) *(from code)* |

In the capture only "Log Entries" and "Running Timers" appear as tabs (the user did not have
`submits_timesheets`). `/timesheets` still loads because its route is always registered.

Routes *(from router)*:

| Route | Handler | Gate |
|---|---|---|
| `/time` | `blocksIndex` (log list) | always |
| `/time/log` | `blocksNew`, which accepts query params `job_id`, `start_date`, `start_time`, `end_date`, `end_time` to prefill the form | always |
| `/time/:id/edit` | `blocksEdit` (redirects to `/time` if the fetch fails) | always |
| `/time/:id/duplicate` | `blocksDuplicate` | always |
| `/time/running` | `blocksRunning` | `view_all_time_logged` |
| `/timesheets`, `/timesheets/:week_number` | My timesheets list and detail | always |
| `/timesheets/submitted`, `/timesheets/submitted/:id` | Approval list and detail | `manage_account` and account `timesheet_approval` |
| `/tracker` | Standalone (undocked) tracker window (server page) | — |

---

## 1. Time log list (`/time`, "Log Entries")

### 1.1 Purpose
A filterable, chartable list of all time entries for a period, grouped by day, with totals. It is
also the place to bulk-mark time as billed outside Paydirt.

### 1.2 Entry points
- Top nav **Time** and the **Log Entries** tab.
- Invoice detail page **Billed Time** link → `/time?range=all-time&invoice=<invoice_id>` (see §1.10).
- Client/project links can deep-link with `?for=client|project|job&id=<id>`.
- After saving or deleting a log on a full page, the app navigates back here.

### 1.3 Layout (top to bottom)
1. **Nav row**: View [range] · date label · "(this week)" · "for" [client/project picker] … prev/home/next buttons (right).
2. **Links row**: ⚙ More Filters (left) and active filter pills; 🖨 Print list · 📄 Download as CSV (right).
3. **Stacked bar chart** (300 px high, full container width).
4. **Summary bar**: four stat columns.
5. **Day list**: day groups with entries.
6. **Mark these logs as billed** button (bottom right).
7. Tracker sidebar on the right edge (global, §6).

Screenshot: `screenshots/11-time-log-entries.jpg`, with filters and menu open in `screenshots/39-time-log-filters-and-entry-menu.jpg`.

### 1.4 Controls

| Control | Type | Options / default | Behaviour |
|---|---|---|---|
| **View** | select2 (no search) | Week (default), Month, Quarter, Year, Custom, All time | Week/Month/Quarter/Year snap to the *current* period (`startOf`/`endOf`). Custom shows two datepickers and defaults to the current month if no dates are set. All time clears the start and end. |
| Custom start / end | 2 datepickers, "to" between | — | An invalid date is ignored. If start > end, both are set to the same day. |
| Date label | text | e.g. "16 to 22 Nov, 2026". Same month: "D to D MMM, YYYY". Otherwise: "D MMM to D MMM, YYYY". | Hidden for Custom and All time. |
| Relative hint | grey text | "(this week)", "(last week)", "(this month)", "(last month)", etc. Blank otherwise. | — |
| **for** | select2 with search | Placeholder "Any client or project", clearable. Options are clients and projects (value `client-<id>` / `project-<id>`). | Sets URL `for` and `id`. When the URL targets a **job** (`for=job`), the picker is replaced by a badge plus "Client / Project / Task" text and an **×** that clears back to `/time`. |
| ◀ previous period / 🏠 current period / ▶ next period | 3 buttons with tooltips "previous period", "current period", "next period" | — | Shift by one range unit, or jump to the current period. **Disabled** for Custom and All time. |
| ⚙ **More Filters** | link that opens a popover | — | Shown only if the user can view financial info **or** view all time *(from code)*. The popover closes on an outside click. |
| Filter by team member | select2 (searchable, clearable) | "Any team member" | Only if `view_all_time_logged`. |
| Filter by billable status | select2 | Both (default) / Billable / Not billable | Only if `view_financial_information`. |
| Filter by billed status | select2 | Both (default) / Billed / Not billed | Only if `view_financial_information`. |
| **Apply filters** | button | — | Applies all three filters at once and closes the popover. |
| Filter pills | blue pills with × | "Team member → Jane", "Billable → true", "Billed → false" | Shown per active filter. × removes that filter. The billable and billed pills show the **raw value** ("true"/"false"), not a label. |
| 🖨 **Print list** | link | — | Opens `/time/print?<state>` in a new tab (server-rendered print view). |
| 📄 **Download as CSV** | link | — | `window.location = /time/export?<state>`. |

**URL state:** every change is pushed to the query string (`start`, `end` as YYYY-MM-DD, `range`, `user`,
`invoice`, `billable`, `billed`, `for`, `id`). Browser back/forward replays it through `popstate`. Data comes
from `GET /time/search?<same params>` → `{blocks:[…], job:{…}|null}` *(from code)*.

### 1.5 Stacked bar chart *(from code + screenshot)*
- Built with d3. One **layer per client**, filled with that **client's colour** (the same colour as the client's
  monogram badge). Each bar is one **day** (grouped by `start_date`). The bar height is the summed duration.
  Stacks are in client-list order. In the screenshot a day with two clients shows two coloured segments
  (e.g. dark teal and pink).
- The colour carries no billable/billed meaning. It is purely client identity.
- Y axis on the right shows whole hours. The minimum scale is about 8.6 h (7.8 h × 1.1) so short days don't fill
  the chart. The tick step grows with the max: 1 h, 2 h (>14 h), 4 h (>24 h), 12 h (>40 h), 24 h (>80 h).
- X axis labels depend on the span. Under 14 days: one label per day ("Mon, Nov 16"). Under 40 days: weekly
  ticks. Under a year: monthly ("Nov, 2026"). Otherwise yearly.
- All time spans from the first to the last entry (at least 7 days). With no entries it shows the last 7 days.
- Animated: bars fade or grow over 800 ms (none if more than 1,500 points). When paging by date, bars slide
  left or right. While fetching, the chart gets a `loading` class.
- It redraws on window resize (200 ms debounce).

### 1.6 Summary bar

| Column | Computation | Visibility |
|---|---|---|
| **Hours logged** | Σ duration in hours, 2 dp, trailing zeros dropped (e.g. `7.5`) | always |
| **Billable hours** | the same, over entries with `billable = true` | always |
| **Unbillable hours** | the same, over `billable = false` | always |
| **Billable value** | Σ `value`, **grouped by currency**. Each currency gets its own line, e.g. "$1,234.00 USD". With no entries it shows "$0 USD" in the account currency. | only with `view_financial_information`. Without it, a spacer centres the other three columns. |

### 1.7 Day groups
- Ordered newest day first.
- For ranges spanning under 7 days (Week), **every day** in the range is listed, including empty ones. Empty days
  in the future at the top are trimmed, so on a Monday only Monday shows. For longer ranges only days that
  have entries are listed.
- **Day header:** "Monday 16 Nov, 2026" (left). The day total in a pill, "7.50 hrs" (right, only if > 0).
- **Empty day:** a centred grey line with a "Log time" link: "Log time on this day".
- **Non-empty day:** the entries, then a grey footer with a "Log time" link: "Log time on this day". The link opens
  the Log Time **modal** with that date preset.
- **More than 1,000 entries** in the result: entries aren't rendered. Each day shows a link
  "Show N time logs on this day" that expands it *(from code)*.
- Entry order within a day: duration-only entries first, then by start time ascending *(from code)*.

### 1.8 Entry row anatomy

| Column | Content |
|---|---|
| User | Round avatar (tooltip: full name) and the user's name |
| What | Client monogram badge (client colour, links to the client page) · **Client** ▸ **Project** ▸ **Task**. Below it, a one-line truncated description, plain text with markdown stripped, or a grey "No description". **Clicking the description** toggles an expanded panel (slide, 200 ms) showing the full description rendered as Markdown (lists, etc.). |
| Time | 🕘 "9:15am - 10:45am", plus "(Nov 17)" if it ends on another day. For duration-only entries: grey "Not specified". 💵 value, e.g. "$150", with tooltip "($100/hr)", or a grey "Not billable". The money line needs `view_financial_information`. |
| Duration | Large "1:30" (h:mm) |
| Menu | ▾ caret dropdown: ✎ **Edit**, ⧉ **Duplicate**, divider, ⊗ **Delete** |

Entry menu actions:

| Item | Behaviour |
|---|---|
| Edit | Fetches the entry and opens the Log Time form in a **modal** (form title "Edit Time Log", button "Save Changes"). On save, the list refetches. Ctrl-click opens the full page `/time/:id/edit`. |
| Duplicate | Fetches the entry, drops its id and opens the modal titled "Copy an existing log", prefilled with the same date, times, task, description and billability. |
| Delete | Confirm dialog: "Are you sure you want to delete this log entry?" with buttons **No, don't delete it** and **Yes, delete it**. Then `DELETE /time/:id`, the entry is removed and a "deleted" flash shows the server message. |

### 1.9 "Mark these logs as billed"
Shown at the bottom of **every** list view (not only invoice mode).

- If **any** entry in the current list is already billed (it has a `line_item_id` or an `external_billing_reference`),
  the button is **disabled**, with tooltip: "Unable to mark list as billed, because one or more log entries has already been billed."
- Otherwise it opens a confirm modal:
  - Heading: **Mark time as billed outside of Paydirt**
  - Body: "If you proceed, all N log entries will be marked as billed, with the reference you specify below. You may
    want to do this if you already billed for this work outside of Paydirt. If you send invoices through Paydirt, you
    probably don't want to do this. Creating an invoice for time logged in Paydirt will *automatically* mark it as billed."
  - Field: "This work was billed outside of Paydirt in:", text input, placeholder "eg. Xero inv-331, MYOB, Excel..."
  - Buttons: Cancel / **Mark list as billed**. The confirm button stays disabled until the field is non-empty.
  - Request: `POST /time/add_external_billing_reference {ids:[…all ids in list], external_billing_reference}`.
    The list is not refreshed explicitly. A Pusher push may refresh it *(unverified)*.
- To undo it per entry, use the edit page (§2.6).

### 1.10 Invoice-filtered mode
- Entered via the invoice page's **Billed Time** action → `/time?range=all-time&invoice=<id>`.
- Same UI, with View = "All time" and nav buttons disabled. It lists only time billed on that invoice. The `invoice`
  param has no visible pill or clear control, so the only way out is to change the URL or navigate away.
- Captured in `views/STATE_invoice_billed_time_time.html` and `screenshots/34-invoice-billed-time.jpg`. The sample
  invoice had no time, so the view showed an empty chart, zeros and the "Mark these logs as billed" button.

### 1.11 States
- **Loading:** the chart gets a `loading` class and the router container gets `router-loading`.
- **Empty:** the chart shows axes only, the summary shows 0 / $0, the day list is empty (or shows "Log time on this
  day" rows for a week), and the "Mark these logs as billed" button is still shown.
- **Live updates:** see §8.

### 1.12 Permissions
- Without `view_financial_information`, the user sees no money column, no Billable value and no billable/billed
  filters. Without `view_all_time_logged`, there is no team-member filter. The server presumably limits results
  to the user's own time *(unverified)*.

---

## 2. Log Time form (new / edit / duplicate)

### 2.1 Purpose
Manually create or change a time entry, either with **start and end times** or with a **date and duration only**.

### 2.2 Where it appears

| Context | Container | h1 / form title | Submit label |
|---|---|---|---|
| `/time/log` page | full page | h1 "Log Time" / "Log Time Worked" | Add Log Entry |
| "Log Time Worked" header button, "Log time on this day", tracker "Log Time" / gap links / "Add a time log" | **modal** (fancybox) | "Log Time Worked" | Add Log Entry |
| `/time/:id/edit` | full page | h1 "Edit Time" / "Edit Time Log" | Save Changes |
| Entry menu → Edit, tracker recent block → Edit | modal | "Edit Time Log" | Save Changes |
| `/time/:id/duplicate` | full page plus a blue info well: "This log entry has been duplicated from an existing log entry, but has not yet been saved." | h1 "Duplicate a log entry" / "Copy an existing log" | Add Log Entry |
| Entry menu → Duplicate | modal | "Copy an existing log" | Add Log Entry |

Screenshot: `screenshots/12-time-log-new.jpg`.

### 2.3 Fields

| # | Label | Control | Default | Notes |
|---|---|---|---|---|
| 1 | **Date and times** – *or* "just enter a duration" (link) | Mode toggle in the label | Last choice, stored in the cookie `blockDefaultToDurationOnly`. **With no cookie, it defaults to duration-only** *(from code)*. | The link text flips between "just enter a duration" and "enter start and end times". In duration mode the label reads "Date and duration". |
| 1a | (computed) | Read-only pill, right side | "0 hours" | Live duration, e.g. "1.5 hours" or "1 hour" |
| 1b | Start date | datepicker (≈100 px, calendar icon) | Today, or the preset date | Format "Nov 16, 2026" |
| 1c | start time | text, placeholder "start time" | blank, or a preset | Times mode only. Parsed leniently (§2.4). **↑/↓** keys move it ±15 min, **Shift+↑/↓** ±60 min. |
| 1d | "to" | — | — | — |
| 1e | End date | datepicker | hidden | Shown only for entries longer than 24 h when loaded ("manualEndDate"). Otherwise it is auto-managed: if end ≤ start, the end date becomes **start + 1 day** (overnight work). If the duration is over 24 h, the end date resets to the start date. |
| 1f | end time | text, placeholder "end time" | blank | It can be relative to start: "+1h30m", "+45m". AM/PM is inferred relative to the start time. |
| 1g | duration | text | "0:00" (new), or h:mm | Duration mode only (§2.4) |
| 1h | (Paused for [h:mm]) | text | — | Only if the entry has `paused_duration > 0` (it came from a timer that was paused). It is subtracted from end − start. |
| 2 | **Task** | select2, searchable, full width | placeholder "Select a Task" | Options are the user's tracker jobs, labelled "Client - Project - Task" and searchable across all three. When editing, the entry's own task is appended if it is no longer in the list (e.g. completed). Changing it triggers the billability lookup. |
| 3 | **Description** (?) | textarea | blank | The (?) tooltip reads "Markdown is allowed in time log descriptions". It grows when it has content. **Ctrl+Enter** submits. |
| 4 | Summary line | text and an "edit" link | "Performed by {Name}. This time is {billable at $100.00/hr \| billable \| not billable}" | While the billability lookup runs, a spinner replaces the second sentence. "edit" removes the summary line and reveals the optional fields. |
| 4a | **Team member** | select2 | current user | Only if `view_all_time_logged`. **Disabled** unless the account has the `extra_users` feature. The help link "Add people to your team" (to `/users`, opens in a new tab) shows when the account has extra users and the user can manage the account. Changing it re-runs the billability lookup. |
| 4b | **This time is** | select2 (no search) | from the lookup | Billable / Not billable |
| 4c | at [rate] per hour | currency text input, centred | from the lookup | Only while Billable **and** the user has `view_financial_information` |
| — | Cancel · or · **Add Log Entry / Save Changes** | link and submit | — | — |

**Billability lookup** *(from code)*: `GET /time/get_billability?job_id=&user_id=` → `{currency_id, billable,
hourly_rate}`. It runs on load for new entries (not duplicates), and whenever the task or team member changes.
The spinner shows for at least 500 ms. Billable status and rate therefore default from the task's rate type and
the user's rate. See 03 for task rate types.

### 2.4 Input parsing *(from code)*
- **Time fields:** accepts `9`, `930`, `9:30`, `9.30`, `9am`, `9:30p`, `21:30` and `now`. Relative values
  `+1h`, `-15m` and `+1h30m` count from the start time (for end) or from now. Without am/pm, the start time
  counts as **pm if the hour is under 8 or 12 or more**, otherwise am. The end time's am/pm is inferred so it falls
  after the start. Values are normalised to `h:mma` (e.g. "9:15am").
- **Duration field:** `2` = 2 h; `1.5` = 1.5 h; `1h 30m`, `90m`, `1:30`. A value it can't parse becomes 0.
- **Computed duration:** end − start − paused_duration in seconds, floored at 0.

### 2.5 Validation
Client-side, run on submit. Invalid fields get a red outline and the submit button **shakes**:
- Duration mode: duration = 0 → duration field invalid.
- Times mode: missing start time, or missing end time.
- Missing start date.
- Missing task (the select2 container turns red).

Server errors re-enable the submit button. Error display is generic (global ajax error handler for 403/404/422/500)
*(from code)*.

### 2.6 Save, cancel and side-effects
- **New/duplicate (page):** `POST /time`. On success the dirty flag clears, the app navigates to `/time` and a
  flash notice shows the server message.
- **Edit (page):** `PUT /time/:id` → navigate to `/time` and flash.
- **Modal:** on success, the form shrinks and a green ✓ notification shows the server flash. It closes after
  1.5 s and runs the callback (the list refetches, or the tracker updates).
- **Cancel:** closes the modal, or on a page calls `history.back()`. For new and duplicate entries it also discards
  the unsaved model.
- **Dirty guard:** any change marks "this time log" dirty, and leaving prompts about unsaved changes *(from code; exact
  dialog text is in 01)*.
- **Edit page extras:**
  - Page links: ⧉ **Duplicate this log entry** (→ `/time/:id/duplicate`) and ⊗ **Delete**. Delete confirms with
    "Are you sure you want to permanently delete this log entry?" and buttons **No, don't delete it** /
    **Yes, delete this log**, then flashes and returns to `/time`.
  - If the entry is billed **through an external reference**, a footer shows "Billed with the reference 'Xero inv-331'"
    and an **×**. The × confirms with "Are you sure you want to remove the external billing reference from this
    log entry? This will mark the log entry as unbilled again." and then calls `PUT /time/:id/remove_external_billing_reference`.
  - Entries billed **on an invoice** get no notice and no lock in the form. Whether the server blocks edits to
    invoiced time is *(unverified)*.

---

## 3. Running Timers (`/time/running`)

**Purpose:** a team overview of who has a timer running right now. Route and tab exist only for users with
`view_all_time_logged`.

**Layout:** a page head titled "Running Timers", then **one row per team member** (every user in the account),
divided by `<hr>`:

| Part | Content |
|---|---|
| Header | Small round avatar and name |
| No timer | Grey "No timer running" |
| Running | **Task** (badge · Client ▸ Project ▸ Task) or grey "No task selected" · description (markdown stripped) · right: "(paused)" if paused, then a ticking **HH:MM:SS** · ▾ menu |

Menu (running row only):

| Item | Confirm text | Buttons | Request |
|---|---|---|---|
| ■ **Stop Timer** | "Are you sure you want to stop this timer? You will be able to edit the log entry once the timer has been stopped." | No, don't stop it / Yes, stop this timer | `PUT /tracker/stop {id}` |
| ⊗ **Discard Timer** | "Are you sure you want to discard this timer? This will stop the timer and discard the time logged. You may want to stop the timer and edit the duration instead." | No, don't discard it / Yes, discard this timer | `DELETE /tracker/cancel {id}` |

Data: `GET /time/running` → `{blocks}`. Rows update live from Pusher (§8): running blocks are added or merged,
stopped or destroyed ones are removed. The ticking clock is computed locally from `current_duration` at load
time and re-renders about once per second.

Screenshot: `screenshots/14-time-running-timers.jpg` (empty state: one user, "No timer running").

---

## 4. Timesheets

### 4.1 Concept *(from code)*
- Weekly timesheet objects per user. A week starts on the account's **first day of week** setting.
- Only users flagged `submits_timesheets` get the **My Timesheets** tab. Approval needs the account setting
  `timesheet_approval` and a user with `manage_account`. Both flags are set in Settings (see 07).
- **Status enum:**

| Value | Label | Badge style | Can submit | Can approve | Can decline |
|---|---|---|---|---|---|
| 0 | Unsubmitted | grey outline | ✓ | — | — |
| 1 | Submitted | blue outline | — | ✓ | ✓ |
| 2 | Approved ✓ | solid green, white text | — | — | ✓ |
| 3 | Declined ✗ | solid red (#b02d2d), white text | ✓ ("Resubmit") | ✓ | — |

### 4.2 My Timesheets list (`/timesheets`)
- Head "My Timesheets". Section title "Timesheets" with ◀ 🏠 ▶ on the right.
- Shows **5 weeks per page**, newest first. ◀ and ▶ move by 5 weeks, 🏠 returns to the current week. Data comes from
  `GET /timesheets?from=YYYY-MM-DD`.
- **Card per week** (the whole card links to `/timesheets/<week_number>`, where `week_number` is an account-wide
  sequential week index such as 1234, not a date):
  - Title: "Monday Nov 16 – Sunday Nov 22"
  - Status badge (top right)
  - Seven day pills: day abbreviation (Mo, Tu…) and hours ("7.50h"), or a "–" icon when 0
  - **Total** pill, e.g. "32.00h"
- Screenshot: `screenshots/13-timesheets.jpg`.

### 4.3 Timesheet detail (`/timesheets/:week_number`)
- Data: `GET /timesheets/:week_number` → `{timesheet, blocks, page}`.
- Main column (span-18):
  - Status badge (right). Heading "Your timesheet for Nov 16, 2026 to Nov 22, 2026".
  - "← back to list" · "Show all time logs" (toggles to "Show timesheet").
  - Right: 🖨 **Print** (`/timesheets/:wk/print`) · 📄 **Download PDF** (`/timesheets/:wk.pdf`).
  - **Default view:** the server-rendered timesheet HTML (`page`), whose exact layout was not captured.
  - **"Show all time logs" view:** seven day sections. Each heading "Monday 16 Nov, 2026" with "x.xx hrs" on the
    right can be clicked to collapse the day. Each entry shows avatar and name · badge Client ▸ Project ▸ Task ·
    🕘 times or "Not specified" · 💵 value or "Not billable" · hours pill · ▾ menu (**Edit** opens the modal form;
    **Delete** confirms with "Are you sure you want to delete this time log?" and buttons **No, don't delete it** /
    **Yes, delete time log**) · description. An empty day shows "No time logged on this day."
- Right column: one large button, **Submit Timesheet**, or **Resubmit Timesheet** when declined. It is disabled unless
  the status is unsubmitted or declined. It sends `PUT /timesheets/:wk`, and the flash reads "Your timesheet for
  {Nov 16, 2026} has been submitted".
- Editing entries reloads the timesheet when the collection syncs.

### 4.4 Submitted Timesheets (approver view) *(from code)*
- List `/timesheets/submitted`: head "Submitted Timesheets", heading "Timesheets for {16 to 22 Nov, 2026}",
  ◀ 🏠 ▶ moving one week at a time. Data comes from `GET /timesheets/submitted?from=`.
  - One row **per user with `submits_timesheets`**: avatar and name · "N.NN hours" · "View details" (only if a
    timesheet record exists) · status badge.
- Detail `/timesheets/submitted/:id`: "Timesheet for {Jane} – {start} to {end}", "← back to list",
  the details toggle, Print (`…/print`) and Download PDF, the same body as §4.3, plus two large buttons:
  - ✓ **Approve** (enabled when submitted or declined) → `PUT /timesheets/submitted/:id/approve`, flash
    "Timesheet for Jane for Nov 16, 2026 has been approved".
  - ✗ **Decline** (enabled when submitted or approved) → `PUT …/decline`, flash "… has been declined".
- There is no comment or reason field on decline. Notifications or emails to the submitter are *(unverified)*.

---

## 5. Block (time entry) data model

### 5.1 In-app model (`Paydirt.Models.Block`, `urlRoot /time`) *(from code)*

| Attribute | Type | Notes |
|---|---|---|
| `id` | int | |
| `user_id` | int | default: current user |
| `job_id` | int | the task. Denormalised: `job_name`, `project_name`, `client_id`, `client_business_name`, `client_color`, `client_monogram` |
| `duration_only` | bool | true means no start or end times |
| `start_date`, `end_date` | date (YYYY-MM-DD, moment) | default today. `end_date` can differ (overnight or multi-day). |
| `start_time`, `end_time` | string `h:mma` | null when duration-only. The server also returns `formatted_start_time` and `formatted_end_time`. |
| `duration` | int seconds | computed client-side in times mode, entered in duration mode |
| `paused_duration` | int seconds | from timer pauses. Forced to 0 for duration-only. |
| `paused_at`, `pause_time`, `pause_date`, `pause_time_with_seconds` | timer pause state | present ⇒ the timer is paused |
| `current_duration`, `current_paused_duration` | int seconds | server-computed live values for running timers |
| `running` | bool | true for an active timer |
| `description` | text (Markdown) | default "" |
| `billable` | bool | |
| `hourly_rate` | decimal | |
| `currency_id` | int | |
| `value` | decimal | rate × hours (server) |
| `line_item_id` | int / null | set when invoiced |
| `external_billing_reference` | string / null | set by "Mark as billed" |
| `billed` | derived | `line_item_id != null \|\| external_billing_reference != null` |
| `suggested_client_id` | int / null | the timer was started from an extension keyword suggestion |
| `updated_at` | datetime | used for last-write-wins in push merges |
| `destroyed` | bool | only in push payloads |

The save payload (`toJSON`) sends only `user_id, job_id, billable, hourly_rate, description, duration,
current_duration, duration_only, paused_at, paused_duration, start_date, end_date, start_time, end_time`.
Times are omitted when `duration_only`.

### 5.2 Public API time log object (`/v1/time`, from `pages/documentation__api__time.html`)

| Attribute | Type | Description |
|---|---|---|
| `id` | integer | unique id |
| `job_id` | integer | task the log is for |
| `user_id` | integer | user who did the work |
| `duration_only` | boolean | created with a duration rather than start and end |
| `date` | date | only set when duration-only |
| `started_at` / `ended_at` | datetime | blank when duration-only |
| `duration` | integer | seconds |
| `description` | string | may contain Markdown |
| `hourly_rate` | decimal | dollars and cents |
| `value` | decimal | hourly rate × duration |
| `billable` | boolean | billable logs are included in invoices |
| `billed` | boolean | included in an invoice, or has an external billing reference |

Endpoints:
- `GET /v1/time`, with filters `start`, `end` (inclusive), `user_id`, `client_id`, `project_id`, `job_id`, `billable`, `billed`.
- `GET /v1/time/{id}`.
- `POST /v1/time`. `job_id` is required. Duration-only entries need `duration` and `date`. Otherwise
  `started_at` and `ended_at` (ISO 8601) are required.
- `PUT /v1/time/{id}`.
- `DELETE /v1/time/{id}`, which returns the deleted object.

### 5.3 Internal endpoints used by this area *(from code)*
`GET /time/search`, `GET /time/export`, `GET /time/print`, `GET /time/get_billability`,
`POST /time/add_external_billing_reference`, `PUT /time/:id/remove_external_billing_reference`,
`GET|POST|PUT|DELETE /time[/:id]`, `GET /time/running`, `POST /tracker/start`, `PUT /tracker/save`,
`PUT /tracker/pause`, `PUT /tracker/resume`, `PUT /tracker/stop`, `DELETE /tracker/cancel`,
`GET /data/tracker`, `GET /data/tracker_jobs`, `GET /data/clients_and_projects`, `GET|PUT /timesheets/:wk`,
`GET /timesheets?from=`, `GET /timesheets/submitted?from=`, `PUT /timesheets/submitted/:id/approve|decline`,
`POST /pusher/auth`.

---

## 6. Tracker sidebar (global, right edge)

### 6.1 Purpose
A one-click timer and task picker that is present on **every** app page. It also shows the day's recent
entries and the gaps between them.

### 6.2 Container and visibility
- A fixed panel, **325 px wide**, full height, on a dark translucent background (`rgba(0,0,0,0.6)`). It slides in
  from the right (0.4 s transition on `right`).
- **Shown or hidden** state persists in the cookie `trackerShowing`. If there is no cookie, the docked tracker
  starts **hidden**.
- **When hidden**, a **handle** tab sticks out at the bottom-left edge of the panel: 🕘 "Time Tracker", or the
  running timer's **HH:MM:SS** if a timer is running. Clicking it shows the panel and focuses the search field.
- **Footer** (docked in-app): **Undock ⇪** (left) · round toggle button (centre) · **Hide ➜** (right).
  - **Undock:** opens `/tracker` in a 325×622 popup window (no menubar or location bar) and hides the docked panel.
    In that standalone window the footer shows a "Paydirt ↗" link to the marketing site instead.
  - **Hide:** collapses the panel to the handle.
  - **Centre toggle:** switches between **Timer mode** (≡ icon) and **Recent entries mode** (🕘 icon).
- The tracker exists in three modes: `in-app` docked, `in-app` undocked (`/tracker` window) and `extension`
  (inside the Chrome extension popup, always shown). In extension mode, actions that would open modals navigate
  inside the extension router instead *(from code)*.

### 6.3 Timer mode, no timer running ("start mode")
Screenshots: `screenshots/11-…`, `12-…` and `13-…` (right side).

| Element | Detail |
|---|---|
| Search field | Placeholder "Search for a task...", autofocused. An × clear button appears once you type. |
| Options line | "or **start timer and choose task later**" (starts a timer with no task) and, right-aligned, **assigned tasks** / **all tasks**. That toggle shows only if the user has `log_time_without_assignment`. It persists in the cookie `trackerOnlyAssignedJobs` (1,000 days). With "assigned" on, the list is filtered to jobs whose `assigned_user_ids` include the user. |
| Task list | Grouped by **project**. Group header: client badge and "Client / Project" on a grey bar. Rows: task name (white). |
| Row controls | Right side: **⋮** (three stacked dots, visible on hover or highlight) opens the *start-in-the-past* menu. **▶** play button starts a timer right away and shows a spinner while starting. |
| Highlight | The keyboard-selected or clicked row gets a **yellow tint** (`rgba(255,255,0,.2)`) and its ▶ turns **green** (#92b856). The first row is highlighted by default. |
| Row click | Highlights the row and toggles its ⋮ menu (clicking does **not** start the timer) |
| Search | Space-separated tokens. **All** tokens must match (case-insensitive) in the task, project or client name. Matches are **bolded** (if under 1,000 jobs or a token is longer than 2 chars). Typing resets the highlight to the first result. |
| No results | "No tasks match your search..." |
| Long lists | Renders 110 jobs, then 100 more each time you scroll within 500 px of the bottom |
| Empty (no tasks) | With financial access: "Add some tasks to track your time!", then "Get started by adding a task for one of your clients." and a list "Add a task for {Client}" (links to `/clients/:id?tour=setup-jobs`). If there are no clients: "You haven't set up any tasks for time tracking yet. Head here to get started." Without financial access: "There are no tasks for you to track time towards..." and "Please contact to your Paydirt account manager to set up time tracking." |

**Keyboard** (in the search field): **↓/↑** move the highlight, clamped to the list. **Enter** starts a timer on
the highlighted task (start mode) or assigns the highlighted task to the running timer (select mode). There are
no global shortcuts to open the tracker *(from code)*.

**Start in the past menu** (⋮ dropbubble, `screenshots/40-tracker-start-in-past-menu.png`, blue bubble):

| Row | Behaviour |
|---|---|
| "← START IN THE PAST" | title row |
| 5 mins ago / 10 / 15 / 30 / 60 mins ago (each with a sub-line "at 8:36pm" and a ▶) | Starts the timer with its start time backdated by that many minutes |
| — divider — **End of last timer** "at h:mma" | Only if the most recent entry ended less than 10 h (600 min) ago. Starts the timer from that moment, so there is no gap. |
| — divider — **Add a time log** (+) | Opens the Log Time modal with this task preset |

### 6.4 Timer mode, timer running

Top section (dark gradient card):

| Element | Detail |
|---|---|
| Big clock | **HH:MM:SS** at 40 px, light weight, with **rolling-digit animation** (only while the window is focused). It dims or gets a paused style when paused. |
| "Started at {9:15am}" | Adds "– yesterday" or "– 16th Nov" if the timer started on another day. **Click** opens a menu: "Enter a time ✎" (inline edit), **← EARLIER** 5/15/30/60 mins and **LATER →** 5/15/30/60 mins (each "at h:mma", and later options that would be in the future are hidden), and "End of last timer at h:mma" (if within 10 h). **Double-click** goes straight to the inline edit: a time input and **save**. Esc cancels. A blank value flashes "Please enter a valid start time". |
| Pause note | "Paused since {time}" while paused, or "Was paused for N minutes" after resuming (if ≥ 60 s) |
| Controls | Two round outline buttons: **❚❚ Pause** / **▶ Resume**, and **■ Stop**. Each shows a spinner while its request runs. |
| ✕ (corner) | A red dropbubble: **Cancel this timer** (shows "Cancelling..." while working). It discards the timer without confirmation. |

Below the card:

| Element | Detail |
|---|---|
| Description | "Add a description..." (click to edit) → an auto-growing textarea, placeholder "What are you working on?". **It autosaves** (debounced 1 s, `PUT /tracker/save`) with a state indicator: "..." (typing) → "saving" → "saved" (fades after 3 s). |
| Billable | "This time is [billable at $100.00/hr ▾]" is an inline dropdown with two options: the billable option, or "not billable". Non-financial users see just "billable". |
| Selected task | The task row (with client/project header) and a ✎ button that enters **select mode** |
| No task yet | If the timer was started "choose task later", the task list shows below in **select mode**: placeholder "Search for a task..." (or "Select a different task..." when changing), each row has a ✓ button, and a click or Enter assigns the task (`PUT /tracker/save {job_id}`). When changing an existing task there is also "or **cancel**". |
| Suggested client | If the timer came from an extension keyword suggestion, the list is filtered to that client with the header "Tasks for {Client}" and an "all clients" link that clears the suggestion. |

**Stop** sends `PUT /tracker/stop` with the current description. The entry moves into Recent entries, a green
flash bubble above the footer says "**Logged 1 hour and 30 minutes for Acme Co**", and the tracker returns to
start mode. Starting a timer on the task that is already running does nothing. Only one timer per user can run.
While a timer is running there are no ▶ buttons, only select mode.

### 6.5 Recent entries mode (toggle button)

| Element | Detail |
|---|---|
| "Log Time" title link and **Earlier Today** heading | The link opens the Log Time modal for today |
| Entries (today, newest first) | Card: badge · "Client / Project" · task name · **duration** (h:mm) · "11:00am to 5:30pm" (or "times not specified") · ▾ menu: ✎ **Edit** (modal; in the undocked window it opens `/time/:id/edit` in a new tab) and ✕ **Delete** (**no confirmation**, `DELETE /time/:id`) |
| Gaps | Between consecutive entries with more than 100 s between them: "10:45am to 11:00am – No time logged" with the gap duration ("0:15"), which turns into a ⊕ on hover. Clicking opens the Log Time modal prefilled with that start and end, so the gap is easy to fill. |
| "Log Time" link and **Yesterday** heading | The same, for yesterday |
| Empty day | "No time logged today" / "No time logged yesterday" with ⊕, which opens the Log Time modal for that date |

Only blocks from the last 2 days are tracked here (`recent_blocks` from the initial page payload, plus pushes).

### 6.6 Messages and errors (flash bubble above the footer)
- Green (#5DBB55) for success, red (#B02D2D) for errors. Each auto-hides after 6 s.
- `409`: "You need to stop the current timer before you can start a new one." `410`: "This timer has already been
  stopped." Both add "**Click here** to reload the time tracker.", which calls `GET /data/tracker`, flashes
  "Everything is refreshed" and stays until dismissed.
- Extension suggestion while a timer is running: "You need to stop the current timer before you can start a new one".
  No tasks for the suggested client: "You don't have any tasks for that client".
- Tracker requests bypass the app's global ajax error dialog (`requestSource = "tracker"`).

### 6.7 Data
- Initial payload (embedded in the page): `running_block`, `recent_blocks` and `tracker_jobs`. Each job has `id,
  name, project_id, project_name, client_id, client_business_name, client_color, client_monogram,
  assigned_user_ids`.
- `POST /tracker/start` params: `job_id?`, `start_date?`, `start_time?` (HH:mm:ss), `current_date`,
  `current_time`, `extension`, `suggestion`, `suggested_client_id`. It returns `{block, jobs, flash?}`.

---

## 7. Chrome extension and keywords

- **Settings → Extensions → Keywords** (`/settings/extensions/keywords`): an info box. "The **Paydirt Chrome
  Extension** searches for keywords to determine who you're working for, and will prompt you to start a timer for
  the matching client when it detects these keywords on the page." It links to a demo video ("this short video") and
  to "recommended keywords." (a modal).
- Recommended-keywords modal ("Some good keywords to use are:"), with example chips and tooltips:
  - Web addresses: `example.com` (matches every page at a domain), `example.com/wp-admin/` (only pages under that
    path), `twitter.com/acme` (the client's Twitter page), `localhost/acme/` ("Development urls work great!").
  - Business names, e.g. "Acme Co".
  - People's names, e.g. "Jane Client".
  - Email addresses: a full address (`jane@example.com`) or a whole domain (`@example.com`).
- Below that is the keyword editor container (`#client_work_signals`), keywords per client. The same editor appears
  at **Clients → {client} → Keywords** (`/clients/:id/keywords`). That tab shows only if the user
  `installed_extension`. See 03 for the editor. Each keyword is a **WorkSignal** (`/work_signals`, attribute
  `text`) with a "Test this keyword" link (a Google search for the term) or, if the extension isn't installed,
  "Install the Paydirt extension for Chrome to use keywords".
- The sidebar copy for clients reads: "Keywords allow the Paydirt browser extension to automatically determine who
  you're working for. It scans the pages you visit for your clients' keywords, and when it finds one, it prompts you
  to start a timer for the matching client. Each keyword is simply a unique word related to a client - like their
  business name, website address, or email address."
- **Flow** *(from code)*: the extension hosts the tracker in `extension` mode and calls
  `tracker.acceptSuggestion(client_id)`. If the client has one task, a timer starts on it. If it has several, a timer
  starts with `suggested_client_id` and the task list filters to that client. If it has none, the user sees
  "You don't have any tasks for that client". The extension also offers project import
  ("Import this project").
- Footer links: "Chrome Extension" (inline webstore install) and the video guides "Tracking Time" and
  "Using the Chrome Extension".

---

## 8. Real-time sync (Pusher)

- On init: `new Pusher(key, {encrypted:true, authEndpoint:'/pusher/auth'})`, subscribing to an
  **account-scoped private channel** (name supplied by the server). Everything arrives as a single event,
  **`data`**, with a payload of `{block?, client?, project?, job?, reason?}`, where `reason` is
  create/update/destroy. A `destroyed` flag marks deletes.
- **Consumers:**

| Consumer | Reaction |
|---|---|
| Tracker | For your own block, or one already shown: it updates the running timer if the push's `updated_at` is newer (cross-tab and cross-device sync), clears it if destroyed or no longer running, and adds or removes recent entries (blocks from the last 2 days). Pushes for other users' blocks are ignored. A destroyed job that matches the running timer clears the timer. Any client, project or job change refetches `/data/tracker_jobs`, throttled to 10 s (jittered when there are more than 10 users). |
| Time log list | A non-running block inside the current range (or any range in All time) triggers a full refetch of `/time/search` |
| Running Timers page | Adds or merges running blocks and removes stopped or destroyed ones |
| Clients collection / projects view | `updateFromPush` merges records by `updated_at` (newer wins). The projects view refreshes, throttled to 10 s. |

- Online/offline: the app tracks `navigator` online plus session state (`Paydirt.online`) *(from code; any visible
  indicator is in 01)*.

---

## 9. Screenshot index
- `screenshots/11-time-log-entries.jpg`: log list, week view, with the tracker shown
- `screenshots/12-time-log-new.jpg`: Log Time page (times mode)
- `screenshots/13-timesheets.jpg`: My Timesheets list
- `screenshots/14-time-running-timers.jpg`: Running Timers (empty)
- `screenshots/34-invoice-billed-time.jpg`: invoice-filtered time list
- `screenshots/39-time-log-filters-and-entry-menu.jpg`: More Filters popover and entry menu
- `screenshots/40-tracker-start-in-past-menu.png`: tracker ⋮ start-in-the-past menu

## 10. Notes for our version
- **Gap-filling is the killer feature.** The tracker's "10:45am to 11:00am – No time logged ⊕" turns idle time into
  one click. Keep it, and consider showing it in the main day list too, not only in the sidebar.
- **Inconsistent destructive actions.** The list's Delete confirms, the tracker's Delete and "Cancel this timer" don't,
  and Running Timers' Stop does. Pick one rule (undo toast instead of confirms).
- **Filter UX is dated.** The pills show raw "true"/"false", invoice mode has no visible chip or exit, and
  "Mark these logs as billed" sits under every list and is all-or-nothing. Make the invoice filter a visible chip, and
  allow selecting entries for bulk actions.
- **Duration-only is the hidden default** (cookie, defaults to true), and am/pm inference (before 8 → pm) can
  surprise people. Make the mode explicit, and show the parsed time back to the user.
- **The chart colours by client, with no legend or tooltips.** Add hover totals, a client legend and a
  billable/unbillable toggle. A timesheet week number used as the URL id (`/timesheets/1234`) is opaque, so prefer
  ISO dates.
