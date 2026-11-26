# 05 — What the Paydirt data tells us

Status: pass 2 · 2026-11-25 · input: `data/` (git-ignored, not copied here)

We exported our own Paydirt account and checked it against the design. This document records
what the data shows and what we changed because of it. Pass 1 (2026-11-19) had the time log and
two sample invoices. Pass 2 adds the invoice export (§3.9–§3.14) and turns §4 into the migration
plan. The checklist is at the end.

This document only gives aggregate numbers. Client names, addresses and bank details stay in
`data/`, which is git-ignored.

---

## 1. What we have

| File | Contents | State |
|---|---|---|
| `*_time_logs.csv` | Every time log: start, end, client, project, job, user, description, hours, rate, price, invoice number, approval status | ✅ Complete: 4,192 rows, Sep 2019 → Nov 2026 |
| `*_invoice_168.pdf` | A fixed-amount invoice with one line | ✅ Sample |
| `*_invoice_184.pdf` | A 4-page time invoice with one line per entry (30 lines) | ✅ Sample |
| `*_quotes.zip` | Quotes archive | ⚠️ Empty: the zip is 22 bytes and has no entries |
| `invoices/<client-slug>/invoice_NNN.pdf` (+ `invoices.zip`) | 173 invoice PDFs, #002 → #189, one folder per client (13 folders) | ✅ Complete as documents. ❌ **No status, payments or paid dates** (§3.9) |
| `paydirt-payments.csv` | Status and paid date for each invoice, copied from Paydirt's invoice list | ✅ 173 rows, totals match the PDFs (§3.9) |
| Client details | Billing emails, full addresses | ❌ Not in the export. Only what the PDFs print (§3.13) |
| Time log after 2026-11-17 | The CSV was exported on 2026-11-18 | ⚠️ Stale: #189 (2026-11-23) bills entries up to 2026-11-19 that the CSV doesn't have, and still shows its other entries as unbilled (§3.10) |

## 2. The numbers

| Measure | Value | Design impact |
|---|---|---|
| Time entries | 4,192 over 7 years (~600/year). Median 2 per day, max 12 | Small. No paging concerns in v1 |
| Clients · projects · tasks | 15 · 30 · 177. One project has 110 tasks | The task picker must search well and hide done tasks (already designed) |
| Members who logged time | **1** | See Brief Q1 (per-member rates) |
| Timesheet approval | Never used (column empty) | Confirms the cut (Brief §6.3) |
| Invoices referenced by time | 145 (#005 → #187). Median 24 entries per invoice, max **129** | The builder and PDF must handle 130+ entries. Success criterion raised (Brief §9) |
| Invoice numbers with no time | 38 between #041 and #183, most of them every other number since mid-2024 | Probably the monthly fixed invoices (see §3.4). The invoice export will confirm this |
| Invoices spanning several projects | 29 of 145 | An invoice is per client, not per project (already designed) |
| Hourly rates | 11 distinct values, from 0 to 100. Every client is in USD in both samples | Brief Q2 (currencies) |
| Price = hours × rate | True for all 4,192 rows, with hours rounded to 2 dp | Line math rule (Brief §7.1) |
| Duration-only entries | 56 (date with no start/end), spread across every year | Start–end **or** duration stays (already designed) |
| Entries crossing midnight | 107, up to 11h 17m | Day rule needed (Brief §7.1) |
| Entries without a note | 404 (10%) | Notes stay optional |
| Multi-line notes | 827 (20%). 793 of them are `*`/`-` bullet lists. The longest is 1,781 characters | Notes are real work logs and print on the invoice. See §3.3 |
| Rate 0 entries | 16, none invoiced | They were used as "non-billable" inside billable tasks. Import them as `billable = false` |
| Non-Latin text | Cyrillic client and project names, and Cyrillic letters in bank details | PDF font coverage (Guide §3) |

## 3. Findings and what changed

### 3.1 Stale unbilled time never goes away

About **$4,800 of unbilled time** sits on 10 clients, with entries from 2020 to 2025 that will
never be invoiced. The largest block is 97 hours from 2024. Paydirt has no way to clear it, so it
stays in "unbilled" for ever. In Paypure this would break principle 2 ("Unbilled is the main
number") on the first day.

**Changed:**
- An entry can be **taken off unbilled**: either *Billed elsewhere* (with a reference) or
  *Written off*. Both are reversible and keep the time in history. (Brief §7.1, Screens S2)
- *Ready to invoice* flags work older than 60 days as stale, with a *Review* link. (Screens S1)
- The migration imports stale entries already written off, after one review. (§4)

### 3.2 Invoices list every entry

Invoice 184 has one line per time entry. Each line is titled `date – project – task`, shows hours
to 2 dp and the rate, and has the entry's note printed below as a bullet list. It runs to 4
pages. This is how we invoice today, and the clients are used to it.

**Changed:**
- The per-entry line layout is now specified exactly, and the default line option is remembered
  per client. Imported clients default to *One per entry*. (Guide §5.13, Screens S9)
- Notes render a Markdown subset on the invoice: bullet lists, line breaks and links. (Guide §5.13)
- PDF pagination rules: a line is never split across pages, the table header repeats, the totals
  stay together, and each page has a footer with the number and page count. (Guide §5.13)

### 3.3 Notes are work logs, not labels

One note in five has several lines, and most of those are bullet lists of what was done. The
longest is 1,781 characters. The time list can't show them in one line, and the timer's note
field has to take a list comfortably.

**Changed:** the entry row shows the first line plus a "+8 lines" expander. The note fields
(panel and timer) are auto-growing textareas that accept up to 5,000 characters. (Guide §5.10,
Screens S3)

### 3.4 Monthly fixed invoices are a quarter of the numbers

Invoice 168 is one line, "Project – Last Month 01-2026", for a fixed amount, with no time linked.
The 38 numbers that have no time look like the same invoice sent monthly since mid-2024. The
client's time is tracked at rate 0 (non-billable).

Recurring invoices are "later" (D5). Until then, this has to be cheap by hand.

**Changed:**
- **Duplicate** is available on every invoice, not only on void ones. It creates a draft with
  the same lines as manual lines and no linked time; the dates are set on send (08 §4.4). (Screens S11, F7)
- The client page shows the *Last invoice* with a `Duplicate` action. (Screens S7)
- D5 now notes that recurring invoices move up if duplicating each month gets tedious.

### 3.5 The invoice layout has things the sheet lacked

Both PDFs show:
- a **summary** line under the parties ("General Development", "Last Month 01-2026");
- the sender's **name, phone and email** under the business name;
- amount due as `$2,307.60 USD`, with the code, because `$` alone is ambiguous for clients abroad;
- payment terms of **7 days**;
- **no tax** lines;
- a **payment instruction** ("leave the reference and comment fields empty") followed by USD wire
  details: beneficiary, beneficiary address, bank, account, SWIFT and a **correspondent bank**.

The two invoices, nine months apart, use **two different banks**.

**Changed:**
- The invoice gets an optional **Summary** field. (Brief §6.1, Guide §5.13, Screens S11)
- The business profile gets a sender name and phone. (Screens S16)
- Documents always show the currency code on totals. (Guide §5.7)
- Payment details become **payment accounts**, several per currency with a default each and an
  optional default per client, with intermediary (correspondent) bank fields and an instructions
  note (07 §8). The invoice copies the account onto its snapshot.
  (Screens S16, S11, S15)
- The public page shows a copyable reference only when one is set, because our instruction is to
  leave it empty. (Screens S15)

### 3.6 Numbering is a plain sequence

Paydirt numbers are plain integers (`184`), shared by all clients. Paypure's default
`INV-{YYYY}-{seq:4}` would be a visible break for our clients.

**Changed:** our workspace continues the Paydirt sequence. The format is `{seq:3}` (so imported
`005` keeps its look) and the next
number is **190** (pass 2, §3.11; pass 1 said 188). New workspaces keep the `INV-` default. Imported numbers are reserved, so the
sequence can never reuse them. (Brief §7.3, D9)

### 3.7 Rates change between billing cycles, almost always

Rates rose step by step over the years: one project went 20 → 30 → 32.5 → 40 → 50, and 14 of
the 30 projects saw at least one change. In 142 of 145 invoices every task has a single rate, so the changes fell between
invoices. Three invoices have one task at two rates, which looks like a one-off price for a
single entry.

**Kept D1** (unbilled time follows the current rate). The data supports it. A one-off price is
handled by editing the rate of that line on the draft, which is already allowed.

Also, the tasks named `Development (Scaled Down)`, `…(2)` up to `…(5)` all have the same rate.
They look like copies made so a task could be invoiced in parts, because Paydirt only let you
select whole tasks. Per-entry selection in the builder (S9) removes the need for that.

### 3.8 Billing periods aren't calendar months

One client is invoiced roughly from the 20th to the 20th, and another from the start of the month
to its end. **Changed:** the builder's period presets are *All unbilled* (default), *Up to
today*, *Up to…* and *Range…*. "Last month" is not a preset. (Screens S9)

### 3.9 The invoice export is documents, not data

The export is one PDF per invoice. `pdftotext -layout` reads all 173 reliably: number, issue and
due dates, billed-to block, summary, every line (title, detail, qty, rate, amount), totals and
the payment block. For **all 173**, total = subtotal = sum of the lines, and every line passes the
line-math check (`amount = round(qty × rate)`). No invoice has tax, discount or a paid/balance line.

What the PDFs **can't** tell us: whether an invoice was paid, when, how much, or whether it was
voided. Paydirt doesn't print that. Without it, every imported invoice would show as overdue
on day one, which breaks principle 2 the same way §3.1 did.

**Resolved (2026-11-25):** Paydirt's invoice list (All invoices, all time) shows a status and
paid date for each invoice. It was copied into `data/paydirt-payments.csv`
(`number,status,paid_on,amount,note`), one row per invoice:

- The list's totals match the PDFs to the cent: USD 426,570.71 and AUD 24,315.16.
- **170 paid, 3 open** (2 overdue, 1 sent). Open total = USD 9,755.26, which equals the three
  invoice totals, so nothing is partly paid. No invoice is void, and #188 isn't in the list.
- Each paid invoice is imported as one payment of its total on its paid date.
- 11 invoices from 2019–2022 were all marked paid on 2022-03-17. That is a bulk clean-up, not
  the real date. They're imported as-is, with a note.
- Issue to paid: median 14 days, 90th percentile 59 days. 123 of 170 were paid after the
  7-day due date. In practice, terms are looser than the invoices say.

### 3.10 The export has two snapshot dates

The time CSV is from 2026-11-18. The PDFs are from 2026-11-24. #189 was issued after the CSV
export: it bills entries up to 2026-11-19, so 26 of its entries show in the CSV as unbilled and
the latest ones are missing entirely. Entries logged since 2026-11-17 are missing too.

**Decision:** take a **final export of both on cut-over day**, after the last Paydirt entry and
invoice. The import refuses to run if any PDF's number has no time rows but the client has
unbilled rows dated inside that invoice's period (that is how #189 shows up today).

### 3.11 Numbering gaps

Numbers #001 to #189 have 16 holes: #001, #041, #064, #066, #072, #077, #088, #122, #125, #129,
#134, #148, #156, #175, #183 and **#188**. No time references any of them. Most are probably
deleted drafts or deleted invoices. #188 is recent and sits between two sent invoices, so it needs
an answer before cut-over (§6).

**Changed:** the next number is **190**, not 188. All 189 numbers are reserved, holes included,
so the sequence never reuses one.

### 3.12 Invoices that are not "one line per entry"

| Kind | Count | Import as |
|---|---|---|
| One line per time entry (dated title `date – project – task`, note as detail) | 142 | `time` lines with the task resolved from the title. The entries are claimed through `invoice_id` (08 §9) |
| One line per task, no dates (the first invoices, before the time log starts on 2019-09-29) | 3 | `time` lines when the task resolves, otherwise `manual` |
| Fixed monthly or bonus lines, no time linked (retainer client from mid-2024, one AUD client in 2021–22) | 25 | `manual` lines |
| A hardware purchase with fees (AUD) | 1 | `manual` lines |
| Time invoices with an extra non-time line (hardware, API credit, a document, a bonus, an AI subscription on every invoice of one client since 2026-03) | 13 | That line as `manual` |
| Time invoices whose time lines outnumber the CSV rows (entries deleted after billing) | 3 (8 lines) | The PDF wins. Those lines have no linked entries |

The recurring subscription line is a monthly expense passed through to the client. Until
recurring invoices exist (D5), *Duplicate* or a saved line covers it.

### 3.13 More currencies, banks and terms than the samples showed

- **Currencies:** 167 invoices in USD, **6 in AUD** (two clients, 2021–2022). Those clients get
  `currency = AUD` and are archived. The workspace stays USD.
- **Payment destinations:** 8 over the years: 6 bank accounts (in Kazakhstan, Latvia and the UK),
  PayPal on 8 invoices, and nothing on 3. Only the newest account is in use (since #161).
  **Decision:** the import creates one live payment account (the current one, default USD). Each
  imported invoice keeps its own payment block as `payment_account_snapshot` text. No archived
  account rows, because PayPal fails the account-number check and nobody needs to pick the old
  ones again.
- **Terms:** 7 days on 161 of 173. 14 days on 7 early invoices, 30–34 days for one AUD client.
  Imported clients get `terms_days` from their latest invoice.
- **Billed-to block:** client name, contact name, then a free line: a contract reference
  ("For Contract №N"), an address or a tax ID. **No billing emails anywhere.** They have to be
  entered by hand, at least for the active clients.

### 3.14 Clients

15 clients in the time log, 13 with invoices. The two without invoices have only unbilled time
(36 entries / $3,896.80 from 2024 on one, 2 entries on the other). Four clients have had activity
in 2026. The other 11 are imported **archived**.

## 4. Migration plan

### 4.1 Shape

Built 2026-11-25: `api/src/paydirt/` (`csv.ts`, `pdf.ts`, `plan.ts`, `load.ts`), run from the
`api` container:

```
pnpm --filter api cli import:paydirt --dir /app/data --dry-run
pnpm --filter api cli import:paydirt --dir /app/data --admin-email <you>
```

- **Extract:** CSV rows plus `pdftotext -layout` for each PDF (`poppler-utils` is in the api dev
  image) → normalised records.
- **Plan and check (`--dry-run` stops here):** builds everything in memory, prints the
  reconciliation report and exits non-zero on a hard error (§4.3). `--allow-stale` downgrades the
  stale-time-log error to a warning, for test loads only.
- **Load:** one transaction into a **new workspace** with an invited admin; it prints the
  one-time link to set a password. It then reads the import back, compares counts and totals with
  the plan, and rolls everything back on any difference. Nothing is merged: a re-run refuses an
  admin email that already exists. The demo workspace can stay; numbers are per workspace.

What the build changed from the draft:

- **Durations:** in 302 entries Paydirt's duration is shorter than end − start (paused timers,
  edited durations). The duration is what was billed, so it wins: the entry keeps its start and
  ends at start + duration.
- **Line → task:** PDFs print names as they were on the day the invoice was sent, and tasks were
  renamed since ("Develpment", "(Scaled Down)(6)"). A dated line takes its task from the entry it
  bills (same date and hours on that invoice); the name is only a fallback. Result: 4,108 `time`
  lines, 97 `manual`.
- **Entries the CSV shows unbilled but a PDF bills** (the 26 on #189) are claimed by that invoice.
- **Payment snapshots** are parsed into account fields. The current account comes out
  clean; old variants keep unplaced lines in `instructions`. The original PDF is the record.

Input folder: the Paydirt export as-is, plus two hand-kept files:

| File | Why |
|---|---|
| `paydirt-payments.csv` | Open, partially paid and void invoices, with paid dates where known (§3.9) |
| `paydirt-overrides.json` | Client billing emails, which clients stay active, the time zone, number holes, and the stale-unbilled rule (§4.2 step 7). Filled 2026-11-25 |

### 4.2 Steps

| # | Data | How |
|---|---|---|
| 1 | Workspace | Business profile and sender from the PDFs' "From" block. USD, terms 7, format `{seq:3}`, reset `never`, next number **190**. Time zone from overrides (see §6) |
| 2 | Payment account | The current USD account, default. Older accounts live only in invoice snapshots (§3.13) |
| 3 | Clients (15) | Name, contact, address/contract line, currency (2 × AUD), terms from their latest invoice, emails from overrides, line layout *One per entry*. 11 archived |
| 4 | Projects (30), tasks (177) | As-is. Project rate = latest rate used. Projects with no 2026 time → `completed`. Tasks with no time in 12 months → done. Merging duplicate tasks stays a manual job |
| 5 | Time entries (4,192+) | Start–end in the workspace zone, so DST and offset changes resolve correctly. Duration-only rows → duration entries. Rate 0 → `billable = false`. Note = description |
| 6 | Invoices (173) | `source = paydirt`, status `issued` (or `void` from payments.csv), number + `number_seq`. One frozen rev 1 with dates, terms, summary, from/to snapshots, payment block snapshot, lines (§3.12) and totals. Original PDF → `invoice_files` (`kind = imported_original`). No re-render (08 §9) |
| 7 | Claims | Entries with *Invoiced in* get `invoice_id` on insert (the billed guard only fires on update). **Unbilled entries:** 2026 entries stay unbilled. The stale list (70 entries / $4,830.90 from 2020–2025) is printed once. Each client is then marked *Written off* or *Billed elsewhere* in overrides |
| 8 | Payments | From payments.csv: one payment = total on `paid_on` for the 170 paid invoices. The 3 open invoices get none, so they show as overdue or sent (§3.9) |
| 9 | Activity | One `imported` activity row per invoice, so the history explains itself |

### 4.3 Checks (report, then the gate)

Hard errors stop the import:

- A PDF total that doesn't equal its lines.
- A CSV *Invoiced in* number with no PDF.
- A line that fails the line-math check.
- Any numbering hole other than those in §3.11.
- Unbilled CSV rows inside an imported invoice's period for that client (stale CSV, §3.10).
- A client folder that matches no CSV client.

Reported only:

- Per invoice, the CSV sum against the PDF's time lines. Expected: 13 differ by exactly their manual line, 3 by deleted entries.
- Totals by client and year, against the PDFs.
- Unbilled by client.
- Open receivables, which should be only what payments.csv lists.
- Next number.

After loading, the report runs again against the database, and the figures must match.

### 4.4 Cut-over

1. Answer §6 and fill the two override files.
2. Build and dry-run against the current export until the report is clean apart from known items.
3. **Cut-over day:** stop the timers in Paydirt and send any last invoice there. Then export
   time and invoices again.
4. Dry-run until clean, then import with `--admin-email`, and open the printed link to set the
   password. Delete the demo workspace later if you like (or `docker compose down -v` first for a
   clean database).
5. Check in the UI: Home *Ready to invoice* shows only the 2026 unbilled entries. *Overdue* shows
   only real open invoices. Open three imported PDFs. Send the next invoice as #190.
6. Keep Paydirt read-only for a month, then cancel it.

| Not migrated | Why |
|---|---|
| Quotes | Export empty (§5) |
| Timesheet approval | Never used |
| The 16 numbering holes | Nothing to import. Numbers are reserved |

## 5. Quotes

The quotes archive is empty. Paypure doesn't have quotes (D5), so nothing in the design depends on
them. To keep the old ones for reference:

1. Ask Paydirt support whether the quotes export is empty by mistake. Send it in the same request
   as the invoice export.
2. If it really is empty, open each quote in Paydirt and download its PDF while the account is
   still active.
3. Store the PDFs with the client's archive (outside Paypure, or as attachments later). We don't
   need a quotes entity for this.

## 6. Checklist

Pass 2 answered:

- [x] Every number accounted for: 173 invoices, 16 holes (§3.11). The numbers without time are
      fixed monthly/bonus invoices (25), early pre-log invoices (3) and one purchase (§3.12)
- [x] Currencies: USD and AUD, no others (§3.13)
- [x] Taxes and discounts: none. Manual lines: §3.12
- [x] Terms and bank per invoice: §3.13

Still open (blocks cut-over):

- [x] **Payments:** 170 paid, 3 open, none partial or void (§3.9)
- [x] **#188:** never sent. It's a reserved hole like the others
- [x] **#168:** confirmed unpaid (overdue since Feb 2026)
- [x] **Stale unbilled:** all of it is *written off* (`Paydirt cleanup`), including the 2024 client
      with $3.9k and no invoices, who will never pay
- [x] **Billing emails:** copied from Paydirt's client pages for the 10 current clients into
      `data/paydirt-overrides.json`. The 5 archived clients have none
- [x] **Time zone:** `Asia/Almaty`. CSV times are local wall-clock. Almaty moved from UTC+6 to
      UTC+5 on 2024-03-01, and the IANA zone handles that, so don't use a fixed +05:00 offset
- [ ] Final export on cut-over day (§3.10)
- [x] Days from issue to payment: median 14, and 72% are paid after the due date (§3.9)
- [ ] Update the brief, guide and screens where §3.9–§3.14 changed them
