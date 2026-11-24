# 01 — Paypure product brief

Status: draft v0.3 · 2026-11-23 · input: [Paydirt reference](../paydirt/README.md),
[our Paydirt data](05-paydirt-data.md)

---

## 1. One line

**Paypure turns the hours you work into an invoice your client can pay.**

Track clients, projects and time on tasks, then turn the unbilled time into an invoice and send it.
Paypure does nothing else.

## 2. Why build it

Paydirt shows that the core loop works: client → project → task → time → invoice. It also shows
how a product builds up clutter over ten years:

- 5 top-level sections, ~15 settings pages, 6 rate types, 5 document types, 3 button systems.
- Integrations (Trello, Basecamp, Redbooth), a Chrome extension with keywords, timesheet
  approval, quotes, recurring invoices and a free invoice tool. All of these sit on top of a
  simple core loop.
- Risky edge cases: "convert to draft" deletes payments, a currency change relabels amounts
  without converting them, and every rate change opens a dialog asking whether to re-rate time.
- Desktop only (min-width 1050px), and a 325px tracker sidebar is always on screen.

Paypure keeps Paydirt's domain model and its best moments (one-click timer, filling gaps in the
day, the client colour badge, building an invoice from unbilled work). It drops everything else.

## 3. Who it's for

| Phase | Audience | Implication |
|---|---|---|
| **Now: internal** | Our own team: a few people who log time across a handful of clients, and one or two people who invoice | Small team, trusted users, two roles at most. Speed of daily use matters more than configurability |
| **Later: external** | Freelancers and small studios (1–10 people) who bill by the hour | Self-serve signup, onboarding, plan limits and online payments. Design so these can be added without restructuring |

**Primary personas**

- **Maker**: logs time every day. Wants to start a timer in one keystroke, fix a forgotten entry
  in seconds and see their week at a glance. Rarely touches money.
- **Biller**: invoices at month end or when a project closes. Wants to see who has unbilled work,
  turn it into a correct invoice in under two minutes, send it, and know when it's paid.

(Internally these are often the same person.)

## 4. The core loop

```
 Client ──▶ Project ──▶ Task ──▶ Time entry ──(unbilled)──▶ Invoice ──▶ Sent ──▶ Paid
   │                      │                                    ▲
   └── rate, currency     └── billable? rate (inherits)        └── manual lines, tax
```

1. **Set up** a client (name, billing email, currency, hourly rate). Add a project, and add tasks
   to it.
2. **Track** time on a task with a timer or a manual entry.
3. **Review**: Home shows each client's unbilled amount.
4. **Invoice**: pick a client, pick the unbilled entries, and check the preview before creating
   the draft.
5. **Send** by email (PDF attached, plus a link to the public invoice page).
6. **Get paid**: record payments. Paypure tracks overdue invoices, and you send reminders.

Every screen should make one of these six steps faster. If a screen doesn't help with any of
them, it doesn't belong in v1.

## 5. Product principles

1. **One job.** Track time and turn it into invoices. Say no to everything adjacent (quotes,
   project management, expenses beyond a line item, reporting suites).
2. **Unbilled is the main number.** The app should always show how much work is unbilled and for
   whom. That number tells the user what to do next.
3. **Fast for daily use.** Starting a timer, switching task or logging a forgotten hour takes ≤ 2
   interactions from anywhere. Keyboard first, mouse friendly.
4. **Money is never silently rewritten.** Billed time is frozen. Sent invoices are locked.
   Payments are never deleted as a side effect. Currency is locked once a client has an invoice.
5. **Sensible defaults, few settings.** Each new setting has to earn its place. Prefer one good
   behaviour over a toggle.
6. **Show the result before committing.** Rate changes, invoice building and sending all show
   what will happen (a preview with live totals) instead of asking a question in a dialog.
7. **Works on any screen.** Desktop for invoicing, phone for timers and checking status.

## 6. Scope

### 6.1 v1 (internal launch)

| Area | In v1 |
|---|---|
| **Clients** | Name, contact name, billing emails, address, tax ID, currency, hourly rate, payment terms override, colour badge (monogram), notes. Archive / restore |
| **Projects** | Name, client, optional hourly rate, optional budget (hours **or** amount) with a progress bar, status active / completed |
| **Tasks** | Name, billing mode (*Hourly*, inheriting the rate · *Fixed fee*, billed whole or in parts · *Non-billable*), optional rate override, optional estimate (hours), done flag, ordering |
| **Time** | Timers (several can run in parallel, one per task; can start in the past, pause/resume any number of times; breaks never count as worked time), manual entry (start/end **or** duration, chosen explicitly), notes (multi-line work logs with light Markdown: lists, links), billable flag, day and week views, gap filling, edit/duplicate/delete with undo, **take off unbilled** (billed elsewhere / written off) |
| **Invoices** | Create from unbilled time (pick individual entries) and/or manual lines; line grouping options (incl. one line per entry with its notes); optional summary line; N taxes (exclusive, not compound); discount line (applied before tax); due date from terms; status lifecycle (§8); multi-page PDF; public link; send by email; manual reminder; record payments and refunds (partial allowed); **corrections** as revisions of the same number, approved and re-sent with a "what changed" note; void (cancel only); **duplicate any invoice** (as manual lines) |
| **Home** | Running timers, today/this week hours, **Ready to invoice** (unbilled per client), outstanding and overdue invoices |
| **Settings** | Business profile (name, sender name, phone, address, tax ID, logo), payment accounts (several per currency, one default each, wire details incl. correspondent bank, instructions note), invoice defaults (terms, numbering, footer, default taxes), email templates (send, correction, reminder, thank-you), team members, your profile |
| **Team** | Two roles: **Admin** (everything) and **Member** (own time, sees clients/projects/tasks, no money or invoices). See the permission table below |

**Permissions (v1 default; Q6 can still change the money row)**

| Action | Admin | Member |
|---|---|---|
| Track, edit and delete **own** unbilled time · use the timer | ✔ | ✔ |
| Edit own time that's on a **draft** invoice (the draft shows *Update*) | ✔ | ✔ |
| Edit time on a **sent** invoice (`Propose change` → correction) | ✔ | — read-only, "Ask an admin" |
| See or edit **other members'** time · log time for someone else | ✔ | — |
| See clients, projects, tasks (names, status, estimates in hours) | ✔ | ✔ |
| Create a task (inline "Create task…" while tracking) | ✔ | ✔ |
| Create or edit clients and projects · edit a task's billing | ✔ | — |
| See money (rates, values, unbilled amounts, budgets in money) | ✔ | — (removed in the API, not just hidden) |
| Invoices, payments, settings other than own profile, members | ✔ | — |

### 6.2 Later (designed for, not built)

Online card payments (Stripe) on the public page · automatic reminder schedule · expenses as a
first-class entity (with date, receipt and markup) · per-user cost/bill rates · recurring invoices
· document language per client (we start with English only, but labels are i18n keys from day
one) · CSV import/export · API and webhooks · client portal (all invoices for a client) ·
self-serve signup and plans.

### 6.3 Cut (not planned)

| Paydirt feature | Why cut |
|---|---|
| Quotes | A separate sales workflow. A draft invoice can serve as an estimate if needed |
| Timesheet submission/approval | Process overhead. Admins can already see all time |
| Running Timers team page | Admins see running timers on the Time page filter instead |
| Trello / Basecamp / Redbooth import | Integrations aren't our job |
| Chrome extension + keywords | Same |
| Preset task groups, preset line items ("inventory") | Replace with **Duplicate project** and **recent lines** suggestions |
| 6 price types | Collapsed to 3 billing modes with rate inheritance (§7.2) |
| Free invoice generator | Marketing, not product |
| Separate Reports section | Home + list summaries cover v1. Revisit when external |

## 7. Domain model (v1)

Paydirt's entities, renamed to the words people use and slimmed down. Field lists here drive the
forms in [03 — Screens](03-screens-and-flows.md).

```
Workspace (business profile, defaults, currency)
 ├─ Member (name, email, role, avatar)
 └─ Client (currency, rate, terms, colour, default_payment_account?)
     ├─ Project (rate?, budget?, status)
     │   └─ Task (billing mode, rate?, fixed_amount?, estimate?, done)
     │       └─ TimeEntry (member, state: running|paused|stopped, date, time_zone, start?, end?, duration, note, billable, invoice?, off_invoice?, version)
     │           └─ Segment (started_at, ended_at?)  — worked intervals; a pause is the space between two
     └─ Invoice (number, status: draft|issued|void, currency, public token, source: paypure|paydirt)
         ├─ InvoiceVersion (rev, frozen_at?, dates, summary, from/to/payment-account snapshots, totals, what changed)
         │   ├─ InvoiceLine (kind: time | fixed | manual | discount, task?, title, detail, qty, unit, rate, taxes[])
         │   │    └─ ← TimeEntry[] (the entries billed by this line, per version)
         │   └─ PDF (rendered once at freeze, sha256)
         ├─ Payment (payment | refund, amount, date, method, note)
         ├─ OutboundEmail (exactly what was sent)
         └─ Activity (created, sent, corrected, viewed, reminded, paid, voided, note…; append-only)
```

### 7.1 Key rules

| Rule | Detail |
|---|---|
| **Billed = claimed** | A time entry is *billed* when it carries an `invoice_id` claim on a non-void invoice (a draft counts, so time can't be invoiced twice). Which line bills it is recorded per version. Deleting a draft or voiding releases the claim ([08 §3.1](08-invoice-lifecycle.md#31-model)) |
| **Billed entries don't change the invoice behind your back** | On a draft, edits save and the draft shows "lines out of date · Update". On a sent invoice, edits to anything the document prints (date, times, duration, task, billable, and the note when notes print) are **staged** as a correction and only applied when the user approves and re-sends it ([08 §5](08-invoice-lifecycle.md#5-changes-to-billed-time-and-other-sources)) |
| **Rates resolve late** | An unbilled entry has **no stored rate**. It always uses the current resolved rate, so changing a rate affects unbilled time with no dialog. The rate is copied onto the draft's lines (an explicit *Update* refreshes them after a rate change) and frozen when the invoice is sent. *(This replaces Paydirt's "update unbilled time logs?" dialogs.)* |
| **One currency per client** | Set when the client is created. It can be changed until the client's first invoice, then it is locked. Totals are never summed across currencies, they are grouped instead |
| **Frozen on send** | A draft reads the business, client and payment account details live. Sending freezes them, with the lines, totals and PDF, into an immutable version. Nothing in a sent version ever changes, enforced by database triggers ([08 §3](08-invoice-lifecycle.md#3-frozen-versions)) |
| **Taking time off unbilled** | An unbilled entry can be marked *Billed elsewhere* (with a reference) or *Written off*. It leaves every unbilled total but stays in time history, and it can be restored. Our data has ~$4,800 of 2020–2025 time that will never be invoiced ([05 §3.1](05-paydirt-data.md#31-stale-unbilled-time-never-goes-away)) |
| **Worked time = sum of segments** | An entry is one or more worked segments. Breaks between them are never counted or billed. Every total reads the stored `duration_seconds` ([06 §2](06-time-and-timers.md#2-pauses)) |
| **An entry belongs to its start date** | An entry that crosses midnight counts towards the day it started, in **the entry's own** time zone (captured when it was created). It shows "+1 day" on its end time. Resuming a paused timer on a new day starts a new entry ([06 §2.6](06-time-and-timers.md#26-midnight-overnight-and-travel)) |
| **Line maths a client can check** | A time line's quantity is its summed duration in decimal hours, rounded **once** to 2 dp. Its amount is that **displayed** quantity × rate, rounded half-up to the cent, so every line checks out on a calculator (as in Paydirt: 5.87 h × $32.50 = $190.78). Exact order of rounding steps: [07 §6](07-money-and-billing.md#6-rounding) |
| **Parallel timers** | A member can run several timers at once (work for several clients at the same time), one per task, up to 5 live. Running or paused both count as live. Starting a timer never stops another one. Overlapping time counts in full on each entry ([06 §2.4](06-time-and-timers.md#24-timer-state-machine)). Paydirt allowed one timer and showed an error instead |
| **Time zones** | Instants are UTC `timestamptz`, calendar days are plain dates, durations are seconds. The display zone is the device's. Invoice dates, Overdue and daily jobs use the **workspace** zone ([06 §3](06-time-and-timers.md#3-time-zones)) |

### 7.2 Rate resolution (replaces 6 price types)

A task has a **billing mode**:

| Mode | Billing | Pill shown on task |
|---|---|---|
| **Hourly** (default) | duration × rate. The rate comes from the first one set: **task → project → client → workspace default**. The workspace default applies only when the client's currency is the workspace currency. If nothing resolves, the pill shows `No rate` and the builder blocks the draft | `€90/h · from project` |
| **Fixed fee** | The task's amount is billed whole or in parts. Time on it is tracked and *covered by the fee*: never hourly unbilled, never linked to a line ([07 §4](07-money-and-billing.md#4-fixed-fee-tasks)) | `€1,200 fixed · €600 billed` |
| **Non-billable** | Tracked, never billed | `Non-billable` |

The UI always shows where a rate comes from ("from client"). You can override it at task level
without leaving the task form.

### 7.3 Numbering

- One workspace-wide sequence with a format pattern (tokens `{seq}`, `{seq:N}`, `{YYYY}`, `{YY}`;
  optional yearly reset; [08 §6](08-invoice-lifecycle.md#6-numbering-and-dates)). The default for
  new workspaces is `INV-{YYYY}-{seq:4}`, reset yearly → `INV-2026-0042`. **Our workspace
  continues Paydirt's sequence:** format `{seq:3}`, never reset, next number **188** (D9). A per-client prefix is dropped: it caused shared and duplicate sequences in
  Paydirt.
- **Drafts have no number** ("Draft · Acme Co"). The number and issue date are assigned when the
  invoice is **sent or marked sent**, so the sequence never has gaps (many tax authorities
  require this). The issue date can't be earlier than the last issued invoice's, so numbers stay
  in date order.
- The next number can be edited in Settings, but only upwards, past every number already used,
  including imported ones.

## 8. Invoice lifecycle

The full rules are in [08 — Invoice lifecycle](08-invoice-lifecycle.md). In short:

```
            send / mark sent                     void (net payments = 0)
  Draft ─────────────────────────▶ Issued ─────────────────────────────▶ Void
    │   (number, freeze rev 1)      │   ▲         (number kept; time back to unbilled)
    │ delete                        │   │
    ▼                               └───┘ correct: rev n+1 → approve → send correction
 (gone; time back to unbilled)            (same number; payments stay)
```

Only `draft · issued · void` is stored. The chip people see is derived from payments and dates:

| Chip | Rule | Colour role | Primary action |
|---|---|---|---|
| Draft | draft | neutral | **Send invoice** |
| Sent | issued, nothing paid, not overdue | info (blue) | **Record payment** |
| Partially paid | issued, 0 < net paid < total | warning (amber) | **Record payment** |
| Overdue · 12d | issued, not fully paid, due date passed in the workspace time zone | danger (red) | **Send reminder** |
| Paid | net paid ≥ total (an overpaid note when above) | success (green) | (none; download PDF) |
| Void | void | muted, number struck through | **Duplicate** |

- **Sent means frozen.** The version the client received never changes: lines, snapshots, totals
  and PDF bytes. Database triggers enforce it, not only the service.
- **Fixing a sent invoice** is a **correction**: *Correct invoice* opens revision 2 of the same
  number in the editor, shows what changed, and needs a short "what changed" note. Approving it
  either sends the correction to the client or saves it without sending. Earlier versions stay
  viewable. Payments stay on the invoice.
- **Void is for cancelling**, not fixing, and only when net payments are 0.
- **Payments are never deleted by the system.** A person can remove one (with undo) or record a
  refund. The status recalculates.
- **Imported** invoices (from Paydirt) are a frozen revision 1 with their original PDF. They can
  receive payments, be duplicated and be voided, but not corrected.
- **Viewed** is not a status. It's an activity ("Viewed by client · 2 Dec, 14:03"), recorded by
  the public page itself so email scanners don't fake it, and a small eye icon on the list.

## 9. Success criteria (internal v1)

| Measure | Target |
|---|---|
| Start a timer from anywhere | ≤ 2 interactions (⌘K → type → Enter, or the top-bar button) |
| Month-end invoice for a client with 50+ entries | < 2 minutes from Home to sent |
| Invoices that need correcting after send | < 5% |
| Time entries logged the same day | > 80% (the gap filler and the reminder help) |
| Large invoices | The builder and PDF stay fast with 130 entries (our largest Paydirt invoice had 129) |
| Paydirt fully retired | All active clients, rates and open invoices migrated |

## 10. Decisions taken in this brief (please challenge)

| # | Decision | Alternative we rejected |
|---|---|---|
| D1 | Unbilled time uses the current rate, which is frozen on invoicing. *Checked against 7 years of data: rates changed between billing cycles in 142 of 145 invoices; the rest is a one-off line edit* | Store the rate per entry and ask on change (Paydirt) |
| D2 | 3 billing modes with inheritance | 6 price types, including per-user rate |
| D3 | Sent invoices are frozen versions. Corrections are revisions of the same number, approved and re-sent with a "what changed" note (08 L1) | Void + a copy with a new number. Revert to draft (which deleted payments in Paydirt) |
| D4 | The number and issue date are assigned when sent, from one global sequence. The issue date can't be before the last issued one | Number at creation, with per-client prefixes |
| D5 | Quotes, recurring invoices, timesheets and integrations are cut. *Monthly fixed invoices are ~¼ of our numbers, so **Duplicate** must make them a 30-second job. If it doesn't, recurring moves up to v1.1* | Keep parity with Paydirt |
| D6 | Expenses go on invoices only as manual lines in v1 | First-class expenses (deferred) |
| D7 | Two roles: Admin and Member | Paydirt's 5-flag permission matrix |
| D8 | English-only documents in v1, multiple currencies from day one | 17 document locales |
| D9 | Our workspace keeps Paydirt's numbering (`{seq:3}`, next 188). `INV-{YYYY}-{seq:4}` is the default for new workspaces only | Start a new `INV-2026-0001` sequence, which our clients would see as a break |
| D10 | Unbilled time can be taken off as *billed elsewhere* or *written off*, reversibly | Delete it, or leave it unbilled for ever (Paydirt) |
| D11 | Pauses are segments inside one entry; breaks are never counted (06 TT1) | Split entries per pause, or a list of pause intervals |
| D12 | Money rules (rounding, fixed fees, taxes, payment accounts) are fixed in [07](07-money-and-billing.md) (M1–M12) | Decide per screen |

## 11. Open questions

1. **Per-member rates.** Do we bill different people at different rates (senior vs junior)? If
   yes, add *member* to the rate chain (task → project → **member** → client). It's cheap to add
   now and hard to add later. *Data: only one person logged time in Paydirt in 7 years.*
2. **Currencies.** Which currencies do we actually invoice in today? If it's only one, multi-currency
   can stay in the model but out of the UI for v1. *Data: both sample invoices are USD. The
   invoice export will confirm.*
3. **Tax.** Which taxes do we charge (VAT rates, reverse charge for EU B2B)? This decides whether
   "reverse charge" needs to be a client-level flag that prints the legal note. *Data: no tax
   on either sample. If that holds, the tax UI stays hidden until a tax is added in Settings.*
4. **Email sending.** Send from our own domain (needs SPF/DKIM setup) or from a Paypure address
   with reply-to?
5. **Migration.** Import historic Paydirt invoices as read-only records, or only open invoices and
   unbilled time? *Draft plan in [05 §4](05-paydirt-data.md#4-migration-plan-draft): all time,
   stale time written off, invoices as frozen imported records once the export arrives
   ([08 §9](08-invoice-lifecycle.md#9-imported-paydirt-invoices)).*
6. **Member visibility.** Should Members see their own time's monetary value? Paydirt hid all money
   from non-financial users.
7. ~~**Payment accounts.**~~ *Answered (07 M11): several accounts per currency, a default per currency and an optional default per client.* The two sample invoices use two different banks. Are both still in use
   (e.g. different clients), or did we switch? This decides whether a client needs a default
   account or the workspace default is enough.
