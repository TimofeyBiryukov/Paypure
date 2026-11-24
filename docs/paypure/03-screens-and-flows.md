# 03 — Screens & flows

Status: draft v0.3 · 2026-11-23 · depends on [01 — Brief](01-brief.md) and
[02 — Design guide](02-design-guide.md)

The inventory of everything to design for v1: the sitemap, then one spec per screen (purpose,
content, actions, states), then the key flows end to end. Each screen spec is meant to be enough
to start a wireframe.

Every place data is entered is a real `<form>` with native Enter behaviour (Guide §7).

Legend: **P** = primary action (one per screen) · ⓜ = mobile notes · ⟵ PD = what changed from
Paydirt.

---

## 1. Sitemap

```
/                          Home
/time                      Time — Week (default) | Day        ?view=week&date=2026-11-16&member=…
/clients                   Clients — Active | Archived
/clients/new               (dialog)
/clients/:id               Client — Overview | Projects | Invoices | Details
/projects/:id              Project — Tasks | Time | Details
/invoices                  Invoices — All | Drafts | Outstanding | Overdue | Paid  ?client=…&period=…
/invoices/new?client=:id   Invoice builder (from unbilled time)
/invoices/:id              Invoice — view (sent/paid/void) or edit (draft)
/i/:public_token           Public invoice page (client-facing, no login)
/settings/profile          Your profile
/settings/business         Business profile & branding
/settings/invoicing        Invoice defaults, numbering, taxes, email templates
/settings/members          Members (Admin only)
/login, /invite/:token     Auth
/reset-password[/:token]   Forgot password → set a new one (Tech §5.3)
```

Overlays, available from anywhere: **Command palette** (⌘K) · **Timer popover** · **Time entry
panel** (new/edit) · **Record payment** panel.

**Navigation:** Home · Time · Clients · Invoices (4 items, against Paydirt's 5 plus
Settings). Projects have no top-level item: you reach them through their client, the palette or
the task picker. Members only see Home · Time · Clients (with money hidden).

---

## 2. Screens

### S1 — Home `/`

**Purpose:** answer "what should I do now?" for both personas.

| Region | Content |
|---|---|
| Header | "Good morning, Jane" + today's date. **P**: `Start timer` (or the running timers' tasks and clocks, large) |
| Today | Today's entries (compact rows) + gap rows + total `5h 40m`. Link: "Open day" → `/time?view=day` |
| This week | Mini bar chart Mon–Sun (client colours), total vs last week (`32h 15m · +3h`) |
| **Ready to invoice** *(Admin)* | One row per client with unbilled work: badge, name, unbilled hours, **unbilled amount**, oldest unbilled date ("since 2 Oct"), `Create invoice` button. Sorted by amount. A per-client threshold (default €1,000) adds a subtle "Ready" tag. Work older than 60 days gets a `Stale` tag and a *Review* link (→ Time, filtered, with *Take off unbilled* ready). Archived clients are left out. *⟵ PD: Paydirt had a threshold setting but didn't use it visibly, and stale time stayed unbilled for years ([05 §3.1](05-paydirt-data.md#31-stale-unbilled-time-never-goes-away))* |
| Outstanding *(Admin)* | Stat strip: Outstanding · Overdue · Paid this month (per currency), then up to 5 overdue/oldest-outstanding invoices with status chips → `/invoices?status=outstanding` |

States: **First run** (no clients) replaces everything with a 3-step checklist: *Add your
business details → Add a client → Track your first hour*. A Member with no tasks sees "Ask an admin
to add you to a project".
ⓜ Stacks in order: timer, Today, Ready to invoice, Outstanding. The week chart is hidden.

---

### S2 — Time `/time`

**Purpose:** see, fix and fill your time. This is the Maker's main screen.

| Region | Content |
|---|---|
| Header | Title "Time". Period nav `‹ This week ›` + `Today` + date picker. Segmented **Week / Day**. **P**: `Add entry` (`N`) |
| Filters | Chips: Member (Admin; "Me" by default), Client/Project, Billable, Invoice state (Unbilled / Billed / Billed elsewhere / Written off). Chips show readable labels ("Billed: No"), not `true/false` *⟵ PD*. Entries on fixed-fee tasks are tagged `Fixed fee` and count as neither unbilled nor billed (07 §4) |
| Stat strip | Total · Billable · Non-billable · Unbilled value (Admin) |
| Chart (week) | 7 bars stacked by client colour, with a legend and hover totals. Clicking a bar jumps to that day |
| List | Day groups (sticky header "Mon 16 Nov · 7h 30m"). Entries (§5.10 of the guide), gap rows (§5.11), and a "+ Add entry for Mon" footer per day. Today is expanded and future days are hidden |
| Bulk bar | Select entries → Move to task · Mark billable/non-billable · Delete · *Take off unbilled…* (Admin: **Billed elsewhere** with a reference, or **Written off**, with an optional note; undo toast, and *Restore to unbilled* on the same rows later) *⟵ PD: this was all-or-nothing on the whole list, and had no write-off* |

**Day view**: a single-day list with gaps shown proportionally, which is best for filling a day.
Duration-only entries sit at the end of the day under "No time of day" and don't create gaps.
An entry that crosses midnight belongs to its start day and shows `22:10–01:48 +1`.
A timeline column on the left (08:00–19:00) is an option to explore in mockups.
Breaks show hatched inside their entry. Overlapping entries are allowed and get a small warning.

States: empty week → "No time tracked this week" + `Start timer`. Billed rows are locked (§5.10).
Running timer entries appear at the top of today with live clocks. With parallel timers the day
header shows `9:30 · 8:00 on the clock` (06 §2.10).
ⓜ Default to Day view, swipe between days, and a FAB opens `Add entry`.

---

### S3 — Time entry panel (overlay)

**Purpose:** create or edit one entry without leaving the page.

| Field | Control | Notes |
|---|---|---|
| Task | Task picker (§5.3) | Required. Recent tasks first. "Create task…" inline |
| Date | Date input | Defaults to the context day |
| Time | Segmented **Start–end / Duration** | Explicit mode, remembered per user. Paydirt used a hidden cookie that defaulted to duration *⟵ PD* |
| Start, End *or* Duration | Smart time / duration inputs | Parsed values are echoed back ("→ 9:30 AM"). End before start → overnight, shown as "+1 day". A wall time that doesn't exist or occurs twice on a DST change is flagged inline (06 §3.5) |
| Worked | Read-only + "2 breaks · 0:45 ▸" | Expands to the segment list: edit a segment, remove a break (merges) or add one (splits). Switching to Duration drops breaks after an inline note (06 §2.9) |
| Note | Auto-growing textarea, light Markdown (lists, links), up to 5,000 characters | Enter adds a new line. `⌘↵` submits the form (Guide §7.2). Typing `- ` or `* ` at the start of a line continues the list on Enter. A hint shows when the task's client gets one line per entry: "This note prints on the invoice" |
| Billable | Switch | Defaults from the task. Shows the resolved rate and value: "€90/h · from client → €135" (Admin). Hidden on fixed-fee and non-billable tasks, replaced by a caption ("Covered by the fixed fee") |
| Member | Picker | Admin only (log for someone else) |

Footer: `Save` (P) · `Cancel` · menu (Duplicate, Delete). For an entry on a **draft** the panel
saves normally and the draft's lines go out of date (*Update* on the draft). For an entry on a
**sent** invoice the panel is read-only with a banner "On 188 · Open invoice" and a
`Propose change` button. Saving a proposed change stages it on the invoice's correction ("Change
added to the correction for 188 · Review"); the entry shows `Change pending` until the
correction is approved or discarded (08 §5.2).

---

### S4 — Timer popover (overlay, from the top-bar pill)

| Idle | Running | Several running |
|---|---|---|
| Task picker, focused. Each result row has `⏵` and a `⋯` menu → *Start 5/15/30/60 min ago*, *Start at end of last entry (10:45)*. ↵ starts | Big clock (worked time) · task (click to change) · note (autosave) · billable switch · "Started 09:12 · edit" with ±nudges · "2 breaks · 0:25" · `Pause`/`Resume` · `Stop` (P) · `Discard` (undo toast). Stop with no task opens "Choose a task to log 1:24". Below: `+ Start another timer` | A list of the live timers, newest first. Each row: client dot, `Client · Task`, clock, `⏸`/`⏵`, `■`. Clicking a row expands it into the *Running* details. The newest one starts expanded. `+ Start another timer` at the bottom opens the idle picker. At 5 live it is disabled: "5 timers live · stop one to start another" |

On stop, a toast says "Logged 1:24 to Acme · Design review" with `Undo` and `Edit`. Starting a
timer never stops the others (06 §2.4). Starting a task that already has a live timer expands that
timer instead.

---

### S5 — Clients `/clients`

**Purpose:** see all clients and their money position. This is the entry point to client work.

| Region | Content |
|---|---|
| Header | Title, tabs **Active / Archived**, search (`/`), **P**: `New client` |
| Table | Client (badge + name) · Active projects · Hours this month · **Unbilled** · Outstanding · Overdue. Sortable. Footer totals per currency (they recalculate with search instead of hiding as in Paydirt *⟵ PD*) |

States: empty → "Add your first client to start tracking time for them." + `New client`.
Members see a list without the money columns.
ⓜ Cards: badge, name, unbilled amount, and an overdue chip if any.

### S6 — New client (dialog)

Fields: **Name** (required) · Billing email(s) · Currency (defaults to the workspace currency) ·
Hourly rate · *More details ▾* (contact name, address as free text, tax ID, payment terms override, colour).
**P**: `Create client` → lands on the client page with "Add a project" focused.

---

### S7 — Client `/clients/:id`

Header: breadcrumb `Clients /`, badge + name (`title-1`), status chip if archived. **P**: `Create
invoice` (disabled with an explanation if there is nothing unbilled; the split menu offers *Blank
invoice*). Secondary: `New project`, a `⋯` menu (Edit, Archive, Delete). Delete is only offered while the
client has no sent or void invoices; otherwise Archive (08 §11).

| Tab | Content |
|---|---|
| **Overview** (default) | Stat strip: Unbilled · Outstanding · Overdue · Invoiced this year. **Last invoice** card (number, date, total, status) with `Duplicate`, which is the fast path for monthly fixed invoices (F7). Active projects list (name, rate pill, budget bar, unbilled). The latest 5 invoices |
| **Projects** | All projects with an Active/Completed filter. Row: name, budget progress, hours, unbilled, `⋯` (Edit, Duplicate, Complete, Delete) |
| **Invoices** | The invoices table (S10) pre-filtered to this client |
| **Details** | Edit form: contact, emails, address, tax ID, currency (locked after the first invoice with an explanation *⟵ PD*; before that, changing it notes "Rates stay as numbers, they aren't converted"), rate, terms, default payment account, invoice line layout (the builder's remembered choice, editable here), colour, notes. Explicit `Save` |

---

### S8 — Project `/projects/:id`

Header: breadcrumb `Acme Co /`, project name, rate pill (`€90/h · from client`), status. **P**:
`Add task`. Secondary: `Create invoice` (scoped to this project), `⋯` (Edit, Duplicate project,
Mark completed, Delete).

| Region | Content |
|---|---|
| Budget card *(if set)* | Used vs budget (hours or money), progress bar with 80%/100% colouring, "€3,200 of €5,000 · 64%". Maths incl. fixed fees: 07 §5. *⟵ PD: Paydirt only had hour estimates* |
| **Tasks** tab (default) | Reorderable list (drag handle, or `⌥↑↓`). Row: name · rate pill · hours · unbilled · estimate bar (if set) · `⏵` start timer · `⋯` (Edit, Log time, Mark done, Delete). Inline "+ Add task" row at the bottom: name + ↵ creates it with the default billing mode. Done tasks are collapsed under "12 done" |
| **Time** tab | Time list (S2 component) filtered to this project |
| **Details** tab | Name, rate override, budget type + amount, notes |

**Task edit** (inline expand or side panel): name, billing mode (segmented: Hourly / Fixed fee /
Non-billable), rate (shows the inherited rate as a placeholder; typing overrides it), fixed amount,
estimate. No re-rate dialog, because unbilled time follows the rate (Brief D1). A one-line note
under the rate field says "Applies to 14h of unbilled time (€1,260)". Switching billing mode
shows its effect inline (07 §4.5); Fixed → Hourly is disabled, with the reason, once part of the
fee has been billed.

---

### S9 — Invoice builder `/invoices/new?client=:id[&project=:id]`

**Purpose:** turn unbilled work into a correct draft in under a minute. This is the Biller's hero
screen.

```
┌ Left: what to bill (480px) ──────────────────┐ ┌ Right: live preview (sheet, scaled) ──┐
│ Client  [● Acme Co ▾]                         │ │                                        │
│ Period  [All unbilled ▾]  Up to… · Range…     │ │   INVOICE · Draft                      │
│                                               │ │   …lines update instantly…             │
│ ☑ Website                     43.5h  €3,915   │ │                                        │
│   ☑ Design          12.5h  €1,125   ▸ 14      │ │   Total €4,350.50                      │
│   ☑ Development     31.0h  €2,790   ▸ 22      │ │                                        │
│ ☐ Retainer (fixed)  Bill [€600] of €1,200 left│ │                                        │
│                                               │ │                                        │
│ Lines   ( ) One per task  (●) One per entry   │ │                                        │
│         ( ) One per task per week             │ │                                        │
│ Show on lines  ☑ dates  ☑ entry notes         │ │                                        │
│                                               │ │                                        │
│ ─────────────────────────────────────         │ │                                        │
│ 36 entries · 43.5h · €3,915 + VAT             │ │                                        │
│ [ Create draft ]                              │ │                                        │
└───────────────────────────────────────────────┘ └────────────────────────────────────────┘
```

- Tree: project → task → (expand ▸) individual entries, each with its own checkbox. Everything is
  selected by default. *⟵ PD: Paydirt let you select whole tasks only*
- **Period presets**: *All unbilled* (default) · *Up to today* · *Up to…* (date) · *Range…*. There is
  no "Last month": our clients are billed on cycles like the 20th to the 20th
  ([05 §3.8](05-paydirt-data.md#38-billing-periods-arent-calendar-months)).
- Fixed-fee tasks show the remaining fee, which can be edited to bill part of it (07 §4.3). Hours
  tracked on them are shown for reference but can't be selected.
- A selected entry with no resolved rate blocks `Create draft`, with a "Set a rate" link.
- No duration rounding option in v1 (07 §6.1).
- Line layouts are specified in Guide §5.13. *One per entry* prints each entry's date, project,
  task and note, which is how we invoice today. Imported clients start on it.
- Must stay fast with 130 entries (our largest invoice had 129): the tree is virtualised, and the
  preview pages like the PDF does.
- Line options are **remembered per client** (Paydirt hid them behind "Show options" with
  account-wide defaults *⟵ PD*).
- The preview renders on the client side and updates instantly. *⟵ PD: Paydirt made a server
  round-trip per change*
- **P**: `Create draft` → S11 in edit mode. Entries are claimed (`invoice_id`) as soon as the draft exists, not
  when it is sent, so they can't be invoiced twice. Deleting the draft releases them. The builder
  shows entries already on another draft as "On draft for Acme (Nov)".

States: nothing unbilled → "Acme Co has no unbilled time." + `Create blank invoice`.
ⓜ The preview becomes a "Preview" tab. Selection is the default view.

---

### S10 — Invoices `/invoices`

**Purpose:** see every invoice and what's owed.

| Region | Content |
|---|---|
| Header | Title, **P**: `New invoice` (opens a client picker → S9) |
| Tabs | All · Drafts · Outstanding · Overdue · Paid (with counts). Void is reachable through a filter |
| Filters | Client, period (Issued in…) and currency chips. Period is independent of the tab *⟵ PD: Paydirt changed the range when you switched type* |
| Stat strip | Outstanding · Overdue · Paid (in period), per currency |
| Table | Number (or "Draft") · Client (badge) · Issued · Due (relative: "in 5 days", "12 days ago" in red) · Total · **Balance** · Status chip · 👁 viewed icon. Sortable. *⟵ PD: Paydirt showed a grid of paper cards with no dates* |
| Row menu | Open · Download PDF · Copy public link · Send reminder · Record payment · Duplicate |

Export: `⋯` → CSV of the current filter, ZIP of PDFs (download directly, no email-only delivery
*⟵ PD*).
ⓜ Cards: number, client, balance, status chip, due date.

---

### S11 — Invoice `/invoices/:id`

One route with two modes decided by status.

**Draft → edit mode**

```
Invoices / Draft · Acme Co                            [Preview] [Delete draft]  [ Send invoice ]
┌ Sheet (editable in place) ───────────────────────────────┐ ┌ Side (300px) ─────────────┐
│ From / Bill to (live until sent; click to pin an edit)   │ │ Issue date   on send ▾     │
│ Summary (optional, one line)                             │ │                            │
│ Lines: drag ⋮⋮ · description · qty · unit · rate · amount│ │ Terms        14 days       │
│   time lines show "14 entries ▸" (expand to see them)    │ │ Due          15 Dec 2026   │
│ + Add line ▾  (Manual · Discount · Unbilled time…)       │ │ Currency     EUR (locked)  │
│ Taxes per line (chips) · Subtotal / taxes / total        │ │ Taxes        VAT 10% ✕ +   │
│ Pay to       Chase USD ▾   │
│ Notes · Payment details (account for the currency ▾)     │ │ Saved · 2 min ago          │
└──────────────────────────────────────────────────────────┘ └────────────────────────────┘
```

- Draft edits autosave (a draft has no external effect), with a "Saved" indicator.
- From, Bill to and the payment account read live from Settings and the client until the invoice
  is sent (08 §3.2).
- Issue date defaults to the send date. It can be set earlier, but not before the last issued
  invoice's date and not after today (08 §6.2).
- If billed entries or rates changed since the lines were made: "2 lines out of date · Update".
  Nothing refreshes on its own. Update keeps fields edited by hand.
- `+ Add line ▾ → Unbilled time…` reopens the builder in add mode.
- **P**: `Send invoice` → S12. Secondary in the menu: *Mark as sent* (sent outside Paypure).

**Sent / Partially paid / Overdue / Paid / Void → view mode**

```
Invoices / INV-2026-0042  [Overdue · 12d]          [PDF] [Copy link] [⋯]   [ Record payment ]
┌ Sheet (read-only) ───────────────────────────────────────┐ ┌ Side ─────────────────────┐
│                                                          │ │ Total        €4,350.50    │
│                                                          │ │ Paid         €2,000.00    │
│                                                          │ │ Balance      €2,350.50    │
│                                                          │ │ Due 15 Dec · 12 days ago  │
│                                                          │ │ [Send reminder]           │
│                                                          │ │ ── Payments ───────────── │
│                                                          │ │ 20 Dec  €2,000  Bank  ⋯   │
│                                                          │ │ ── Activity ───────────── │
│                                                          │ │ Viewed by client · 16 Dec │
│                                                          │ │ Sent to jane@… · 1 Dec    │
│                                                          │ │ Created · 1 Dec           │
│                                                          │ │ + Add note                │
└──────────────────────────────────────────────────────────┘ └────────────────────────────┘
```

- The primary action depends on status: Sent/Partially paid → `Record payment` · Overdue → `Send
  reminder` (with Record payment as secondary) · Paid → none · Void → `Duplicate`.
- **Duplicate** (any status) creates a draft for the same client with the same lines, summary,
  notes and taxes, and **no linked time**. Time lines become manual lines with the same text and
  amounts, and a banner offers "Replace with unbilled time". The issue date is set on send
  (08 §4.4).
- `⋯` menu: Resend · Correct invoice · Duplicate · View billed time (→ `/time?invoice=:id`, shown as a visible
  removable chip *⟵ PD*) · **Void…** · Copy public link / Regenerate link.
- A banner explains the lock: "Sent invoices can't be edited." with `Correct invoice` inline.
- **Correction mode** (08 §4.2): the draft editor with the header "Correction to 188 · revision 2",
  a changes panel (changed/added/removed lines, staged entry edits, totals before → after), a
  required *What changed* field (prefilled from the diff), and `Send correction` (P) · `Save
  without sending` · `Discard correction`. A warning shows when payments exceed the new total.
- "N changes pending · Review and send" banner when billed entries have staged edits.
- Side panel adds **Previous versions** (date, what changed, PDF). Each email in Activity opens a
  read-only view of exactly what was sent, with its delivery state (Queued · Sent · Failed ·
  Retry).
- Void is disabled while net payments ≠ 0, with the reason.

### S12 — Send invoice (dialog)

| Field | Content |
|---|---|
| To | If the invoice has no payment account, a warning repeats here ("No payment account for USD"), but doesn't block. Client billing emails (chips, editable). If there are none: inline "Add an email" that also saves it to the client |
| Cc | Optional. "Send me a copy" checkbox |
| Subject, Message | From the template, with variables already filled in. Missing variables are highlighted inline and block sending (as in Paydirt, but shown in place) |
| Attachments | `INV-2026-0042.pdf` (preview link) + "Includes a link to view online" |
| Footer | `Send test to me` (a watermarked, unnumbered copy to you only) · **P** `Send invoice` |

On send, one transaction assigns the number and issue date, freezes the version and queues the
email (08 §7.2). The invoice is Sent from that moment, whatever happens to delivery. A toast says
"188 sent to jane@acme.co". The form carries a hidden idempotency key, so a double submit sends
once. The reminder and correction dialogs are the same dialog with their own template (the
correction one includes the "what changed" text).

### S13 — Record payment (side panel)

Amount (defaults to the balance) · Date (today) · Method (Bank transfer / Card / Cash / Other) ·
Note · ☐ Send thank-you email. **P** `Record payment`. Overpayment shows a warning but is allowed.
A *Refund* variant of the same panel records money paid back (08 §8).
The status updates live in the header behind the panel.

### S14 — Void invoice (confirm dialog)

Void is for cancelling an invoice that shouldn't exist (wrong client, sent twice). To fix one,
use *Correct invoice*. "Void 188?" · consequences listed: *"14 time entries go back to unbilled ·
the number stays in your sequence · the client's link will show 'Void'"* · optional reason ·
**Danger** `Void invoice`. Only offered when net payments are 0 (08 §4.3).

---

### S15 — Public invoice `/i/:token`

**Purpose:** the client sees the invoice and how to pay it, with no login.

| Region | Content |
|---|---|
| Top | Business logo + name. Status line: "Due 15 Dec 2026 · €2,350.50 outstanding" (or "Paid · thank you", or "This invoice was voided") |
| Actions | `Download PDF` · `Print`. Later: `Pay by card` (Stripe) |
| Sheet | The invoice sheet |
| Payment details | The payment account snapshot from the invoice: instructions note first (prominent), then the wire details, each with a copy button. A reference is shown and copyable **only if the account sets one**; ours tells clients to leave it empty |
| Payments | List of received payments + balance *⟵ PD: the client couldn't see this* |
| Footer | "Sent with Paypure" (small; removable later) |

It shows the latest sent version, with *Previous versions* below when it was corrected. A
"Viewed" activity is logged by a beacon once the page has been visible for 2 s, so email
scanners don't count; signed-in members don't count either (08 §10). The link can be
regenerated, which revokes the old one.
ⓜ This is a must-have: clients open invoice emails on phones.

---

### S16 — Settings

Same shell. Left sub-nav: **Profile · Business · Invoicing · Members**. Each page has explicit
`Save`, except list rows (taxes, members), which save inline.

| Page | Content |
|---|---|
| Profile | Name, email, avatar, **time zone** (seeded from the device; a banner offers to switch when the device zone differs, 06 §3.4), time format (12/24h), week start, password |
| Business | Business name, sender name, address (structured lines), phone, tax ID, logo (with live sheet preview beside the form), billing email (the reply-to). **Payment accounts**: a list, several per currency with one default each (07 §8). An account used by a sent invoice can be archived, not deleted. Each has beneficiary name and address, bank name and address, account number/IBAN, SWIFT/BIC, an optional **correspondent bank** (name, account, SWIFT), an optional reference hint and an instructions note. Changing an account never changes sent invoices (they keep their snapshot). *⟵ PD: these were scattered across 3 pages and stored as a free-text footer* |
| Invoicing | Workspace currency · **workspace time zone** (invoice dates, Overdue, daily jobs) · default hourly rate · default payment terms · numbering format (tokens `{seq}` `{seq:N}` `{YYYY}` `{YY}`, yearly reset on/off) + next number (preview "Next: INV-2026-0043"; ours is `{seq:3}` → "Next: 188". It can only go up, past every used number) · default taxes (list: name, %; N allowed) · default notes · email templates (Send, Correction, Reminder, Thank-you) with variables and a test send |
| Members (Admin) | Table: name, email, role (Admin/Member), status (Active/Invited). `Invite member` (email + role). Deactivate (time is kept) |

---

### S17 — Command palette (⌘K)

Sections, filtered by query: **Actions** (Start timer on…, Add entry, New client, New invoice for…)
· **Go to** (pages, clients, projects, invoices by number) · **Recent**. Typing a task name
offers `⏵ Start` and `+ Log time` directly.

---

## 3. Key flows

### F1 — First run (new workspace)

1. Sign in, then land on Home with the setup checklist.
2. *Business details* → Settings/Business (name, address, logo, bank details). This is needed
   before sending but not before tracking, so it can be skipped.
3. *Add a client* → S6 dialog → Client page with "Add a project" ready.
4. Project → inline "Add task" (Hourly, from client rate).
5. *Track your first hour*: `⏵` on the task row. The timer appears in the top bar and the checklist
   completes.

### F2 — Track a day (Maker)

1. 09:05 ⌘K → "acme des" → ↵: the timer runs on *Acme / Website / Design*.
2. 10:40 click the top-bar pill → change the task to *Development* (or stop it and start a new
   one).
   11:00 a long export for Globex needs watching: ⌘K → "globex exp" → ↵. Both timers run in
   parallel and the pill shows `+1`. 11:50 stop the Globex timer from its row in the popover.
3. Lunch: `Pause`. 13:15 `Resume`; the break never counts.
4. 16:00 forgot to restart: Time → Day shows a gap row `12:30–16:00 · 3:30 not tracked [+ Fill]`
   → the panel opens with the times filled in → pick a task → Save.
5. End of day: the Home "Today" total shows 7h 45m.

### F3 — Month-end invoice (Biller)

1. Home → *Ready to invoice* → Acme Co `€4,350 · since 2 Nov` → `Create invoice`.
2. Builder S9: everything is selected. Untick 2 entries ("internal meeting"). Lines: one per task,
   with dates. The preview updates.
3. `Create draft` → S11 edit. Add a manual line "Hosting (Nov) · €40". Check VAT.
4. `Send invoice` → S12 → `Send`. The number is assigned and the status is Sent.
5. Elapsed time ≈ 90 s. The entries now show "On INV-2026-0042".

### F4 — Getting paid

1. Bank shows €2,000 from Acme → Invoices → INV-0042 → `Record payment` → €2,000 → status
   *Partially paid*.
2. The due date passes → status *Overdue · 1d*. The owner gets an email notification. Home shows
   it under Outstanding.
3. `Send reminder` → S12 with the reminder template (days overdue already filled in) → send.
4. The remaining €2,350.50 arrives → record it → *Paid*. ☑ thank-you email.

### F5 — Correcting a sent invoice

1. The client reports a wrong rate on 188 (Sent, $2,000 already paid).
2. `Correct invoice` → revision 2 opens in the editor. Fix the line's rate (or fix the project
   rate and press *Update* on the out-of-date lines). The changes panel shows the total before →
   after, and *What changed* is prefilled.
3. `Send correction` → S12 with the Correction template → send. Still number 188, now *rev 2*. The
   $2,000 payment stays and the balance is recalculated.
4. Revision 1 stays under *Previous versions*, with the PDF and email that went out.

### F6 — Rate change mid-project

1. Project Details → rate €90 → €100. The inline note says "Applies to 14h of unbilled time
   (+€140)". Save.
2. Unbilled entries are now valued at €100. Entries already invoiced keep €90 on their invoice
   lines. No dialog appears. *(Paydirt asked "update unbilled time logs?" on every change.)*

### F7 — Monthly fixed invoice

About a quarter of our Paydirt invoice numbers are one fixed line sent every month, with no time
linked ([05 §3.4](05-paydirt-data.md#34-monthly-fixed-invoices-are-a-quarter-of-the-numbers)).
Until recurring invoices exist (D5), this is the path, and it must take under 30 seconds:

1. Client page → *Last invoice* card → `Duplicate`.
2. The draft opens with the same line, "Project – Last Month 10-2026", as a manual line. Edit the
   month in place (a nice-to-have offers "Update to 11-2026").
3. `Send invoice` → S12 → `Send`.

### F8 — Clearing stale unbilled time

1. Home → *Ready to invoice* → a client tagged `Stale · since Apr 2024` → *Review*.
2. Time opens filtered to that client's unbilled entries, all selected.
3. *Take off unbilled…* → **Written off** (or **Billed elsewhere** + a reference) → confirm. The
   client leaves *Ready to invoice*, and an undo toast appears.
4. The entries stay in Time with a `Written off` tag. *Restore to unbilled* brings them back.

---

## 4. Screen checklist for the design phase

| # | Screen | Desktop | Mobile | States to draw |
|---|---|---|---|---|
| S1 | Home | ✔ | ✔ | first run, Member, normal, timer running |
| S2 | Time (week, day) | ✔ | ✔ (day) | empty, filtered, bulk select, billed rows, written off / billed elsewhere, long multi-line note, duration-only, overnight |
| S3 | Time entry panel | ✔ | ✔ sheet | new, edit, billed/locked, parse hints, error, with breaks, DST invalid time |
| S4 | Timer popover + top-bar pill | ✔ | ✔ | idle, running, no task, paused, paused overnight → resume, long-running, start-in-past menu, 2–5 parallel timers (one paused), at the limit |
| S5 | Clients | ✔ | ✔ | empty, search, archived, Member |
| S6 | New client | ✔ | ✔ | collapsed, expanded |
| S7 | Client (4 tabs) | ✔ | ✔ | nothing unbilled, archived, currency locked |
| S8 | Project | ✔ | ✔ | with/without budget, over budget, task edit, done tasks |
| S9 | Invoice builder | ✔ | ✔ | nothing unbilled, partial selection, entries on another draft, 130 entries, one-per-entry preview |
| S10 | Invoices | ✔ | ✔ | each tab, empty, multi-currency |
| S11 | Invoice (edit, view per status) | ✔ | ✔ | draft, lines out of date, sent, partially paid, overdue, paid, overpaid, void, imported, duplicated draft, correction open, changes pending, previous versions, email failed |
| S12 | Send / correction / reminder dialog | ✔ | ✔ | no email, missing variable, no payment account |
| S13 | Record payment | ✔ | ✔ | partial, overpayment |
| S14 | Void confirm | ✔ | ✔ | normal, disabled because of payments |
| S15 | Public invoice | ✔ | ✔ | outstanding, paid, void, corrected (previous versions) |
| S16 | Settings (4 pages) | ✔ | ✔ | — |
| S17 | Command palette | ✔ | — | empty query, task match |
| — | Invoice PDF | A4 | — | 1 fixed line (like #168), 4 pages of per-entry lines with notes (like #184), Cyrillic names |

**Suggested order:** S4 + S2 (track) → S9 + S11 + S12 (invoice) → S1 (ties them together) → the
rest. The two hero flows (F2, F3) should be prototyped first because they test the product.
