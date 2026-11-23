# 05 — What the Paydirt data tells us

Status: pass 1 · 2026-11-19 · input: `data/` (git-ignored, not copied here)

We exported our own Paydirt account and checked it against the design. This document records
what the data shows and what we changed because of it. **Run this pass again** when the full
invoice export arrives. The checklist is at the end.

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
| Invoices export | Every invoice with status, dates, payments and manual lines | ⏳ Waiting on Paydirt |

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
number is **188**. New workspaces keep the `INV-` default. Imported numbers are reserved, so the
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

## 4. Migration plan (draft)

| Data | How |
|---|---|
| Clients, projects, tasks | Import as is. Tasks with the same name and one rate can be merged later (by hand, not by the script) |
| Rates | The latest rate per project becomes the project rate. Older rates live on in the imported invoices' lines |
| Time entries | Import all 4,192. Duration-only rows become duration entries. Rate 0 becomes `billable = false` |
| Billed entries | Claim each one for its imported invoice (`invoice_id`, no line mapping). Until the invoice export arrives, mark them *Billed elsewhere* with reference `Paydirt #NNN`; the script converts them later (08 §9) |
| Stale unbilled (2020–2025) | Show the list once, then import as *Written off*, with reference `Paydirt cleanup` |
| Current unbilled (Oct–Nov 2026) | Import as unbilled, so they appear in *Ready to invoice* |
| Invoices | **Waiting on the export.** Plan: *Imported* invoices, each a frozen revision 1 with number, dates, totals, payments, lines if the export has them, and the original PDF (08 §9) |
| Quotes | None to import (see §5) |
| Payment accounts | Both USD accounts from the samples. The newer one is the default. Each client's default is set from its latest invoice once the export arrives |
| Prices | Re-verified on import with the 07 §6 rounding (it matches all 4,192 rows) |
| Sequence | Next number 188, format `{seq:3}`, never reset |

## 5. Quotes

The quotes archive is empty. Paypure doesn't have quotes (D5), so nothing in the design depends on
them. To keep the old ones for reference:

1. Ask Paydirt support whether the quotes export is empty by mistake. Send it in the same request
   as the invoice export.
2. If it really is empty, open each quote in Paydirt and download its PDF while the account is
   still active.
3. Store the PDFs with the client's archive (outside Paypure, or as attachments later). We don't
   need a quotes entity for this.

## 6. Re-run checklist (when the invoice export arrives)

- [ ] Every number from #005 to #187 is accounted for. Are the 38 numbers without time the
      monthly fixed invoices?
- [ ] Statuses and payments: are there partial payments, overpayments or written-off invoices?
- [ ] Currencies: is everything USD? (Brief Q2)
- [ ] Taxes and discounts: are there any lines that aren't time? (Brief Q3)
- [ ] Manual lines: the kinds and how often (expenses, hosting, fixed amounts)
- [ ] Payment terms per client, and which bank account each invoice used (sets client defaults)
- [ ] Any discounts, or fixed fees billed in parts?
- [ ] Days from issue to payment (does the 7-day term hold, and how often are invoices overdue?)
- [ ] Update §2–§4 here, then the brief, guide and screens
