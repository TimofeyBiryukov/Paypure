# 07 — Money & billing rules

Status: draft v0.1 · 2026-11-23 · depends on [01 — Brief](01-brief.md) §7,
[04 — Tech stack](04-tech-stack.md) §5.2 and [05 — Paydirt data](05-paydirt-data.md) · invoice
lifecycle, freezing and sending are in [08](08-invoice-lifecycle.md)

The exact rules for amounts: how money is stored, how rates resolve, how fixed fees work, how
durations and amounts are rounded, how taxes and discounts add up, and which bank details go on
an invoice. Everything here is implemented once in `@paypure/domain` and tested with the
examples in §9. The API and the builder preview both call it (Tech T7).

The rules match Paydirt wherever our clients can see the result, so an invoice from Paypure adds
up the same way as the ones they already get from us.

---

## 1. Money representation

| Rule | Detail |
|---|---|
| **Integer minor units** | Every amount is an integer count of the currency's minor unit (cents for USD). The currency is stored next to it or follows from the owner (client, invoice) |
| **Column type `integer`** | Postgres `int4`, Prisma `Int`, JS `number`. The limit is 21,474,836.47 in a 2-dp currency, which is far above any invoice we send. We do **not** use `bigint`: Prisma maps it to JS `BigInt`, which `JSON.stringify` throws on, and every schema, Server Action and test would need special handling |
| **Rates** | `rate_minor` is minor units **per hour**, an integer. $32.50/h is `3250` |
| **Percentages** | Integer **basis points**: 10% is `1000`, 7.7% is `770`. No floats anywhere in the money path |
| **Intermediate maths** | Products such as `qty × rate` can pass 2³¹. They are computed as JS `number` (exact up to 2⁵³) or as `numeric`/`bigint` in SQL, then rounded back into `integer` |
| **SQL aggregates** | `SUM(integer)` returns `bigint` in Postgres, and Prisma `$queryRaw` turns that into `BigInt`. Raw queries cast money sums with `::int`. An overflow is then a loud error, not a silent wrong number |
| **On the wire** | `{ "minor": 19078, "currency": "USD" }`. The zod schema `Money` in `@paypure/domain/schemas` is the only shape. Display strings are never sent by the API |
| **Formatting** | `formatMoney(money, locale)` uses `Intl.NumberFormat` with the exponent from the currency table below |

### 1.1 Currencies

`@paypure/domain/currency.ts` holds an explicit table of supported currencies and their exponents.
We don't derive the exponent from `Intl`, because browser and Node versions disagree for a few
currencies.

| Exponent | Currencies (v1 list) |
|---|---|
| 2 | USD, EUR, GBP, CHF, CAD, AUD, ILS, PLN, CZK, SEK, NOK, DKK |
| 0 | JPY, KRW, HUF *(HUF is 0 for cash in practice; we bill it as 0)* |

Adding a currency is one row in this table. A currency outside the table can't be chosen.

## 2. Rates

### 2.1 Resolution

An hourly task's rate is the first one set in **task → project → client → workspace**. Task,
project and client rates are always in the **client's currency** and carry no currency of their
own.

The **workspace default rate** is in the workspace currency. It applies **only when the client's
currency is the workspace currency**. A USD client in a EUR workspace never inherits €90 as $90.

| Resolves from | Pill | Unbilled value |
|---|---|---|
| task / project / client / workspace | `€90/h · from client` | duration × rate |
| nothing | `No rate` in the warning colour | `—`, and the hours still count |

When no rate resolves:
- *Ready to invoice* lists the client with its hours and a `Set a rate` link instead of an amount.
- The builder (S9) shows the task's entries with `No rate` and won't create the draft while any
  selected entry has no rate. The message names the fix: "Set a rate for Acme Co to bill 12.5h."
- A rate of `0` is a real rate. It resolves and bills at zero. Use *Non-billable* to stop billing.

### 2.2 Changing a client's currency

Allowed until the client's first invoice (Brief §7.1). Rates are **not converted**: the form shows
"Rates stay as numbers: €90/h becomes $90/h on this client and its 3 projects" before saving.
This replaces Paydirt's silent relabel.

## 3. Billing modes and time entries

A time entry is valued only through its task's billing mode. The entry's `billable` flag is
stored, but money uses it only on hourly tasks.

| Task mode | Entry `billable` switch | Entry counts as |
|---|---|---|
| Hourly | Editable. Defaults to `true` | Hourly unbilled when `billable` and not billed or taken off |
| Fixed fee | Hidden. The panel shows "Covered by the fixed fee" | Tracked time only. Never hourly unbilled, never linked to a line |
| Non-billable | Hidden. Shows "Non-billable task" | Tracked time only |

A new entry stores `billable = (task.mode = 'hourly')`. The flag isn't rewritten when the task's
mode changes, so switching a task back restores each entry's own choice.

The time list tags entries on fixed-fee tasks `Fixed fee` (like `Non-billable`). The *Invoice
state* filter treats them as neither unbilled nor billed.

## 4. Fixed-fee tasks

A fixed fee is a one-off price for a piece of work, for example "Logo design €1,200". It is not
the monthly retainer: a monthly invoice is a manual line on a duplicated invoice (Screens F7),
because it repeats.

### 4.1 Fields

| Table | Column | Type | Rule |
|---|---|---|---|
| `tasks` | `billing_mode` | enum `hourly`, `fixed`, `non_billable` | Default `hourly` |
| `tasks` | `rate_minor` | `integer` null | Hourly override. Must be null unless `billing_mode = 'hourly'` (check) |
| `tasks` | `fixed_amount_minor` | `integer` null | Required and `> 0` when `billing_mode = 'fixed'`, null otherwise (check). Client currency |
| `invoice_lines` | `kind` | enum `time`, `fixed`, `manual`, `discount` | |
| `invoice_lines` | `task_id` | FK null | Required for `time` and `fixed` (check). Null for `manual` and `discount` |

### 4.2 What is unbilled

```
billed_fixed(task)   = Σ invoice_lines.amount_minor
                       WHERE kind = 'fixed' AND task_id = task.id
                       AND invoice.status <> 'void'
                       per invoice, per task: the larger of
                           -- (a) its lines in current_version_id (what was sent), and
                           -- (b) its lines in the open version (a draft or an open correction).
                           -- An open correction can reserve more of the fee, but only releases
                           -- it when approved, like time entries (08 §4.2). Discarding it can
                           -- then never double-bill. Superseded revisions never count
unbilled_fixed(task) = max(task.fixed_amount_minor − billed_fixed(task), 0)
```

- A fee can be billed in parts over several invoices. Each part is its own `fixed` line.
- Voiding an invoice drops its part from `billed_fixed`, so that part is unbilled again. Deleting
  a draft does the same.
- A done task with unbilled fee still shows in *Ready to invoice*. Done means the work is
  finished, not that it is paid for.
- Its *since* date in *Ready to invoice* is the task's creation date.

### 4.3 In the builder (S9)

```
☑ Logo design (fixed fee)         Bill [ €600.00 ] of €1,200 remaining
    18.5h tracked · covered by the fee        (not selectable)
```

- The amount defaults to the remaining fee and can be lowered to bill part of it. It must be
  `> 0` and `≤ remaining`. To bill more, raise the task's fee first.
- The line it creates: `kind = fixed`, `qty_hundredths = 100`, `unit = 'fixed'`,
  `rate_minor = amount`, title `Project · Task`, and a sub-line frozen at creation:
  - Whole fee: "Fixed fee".
  - Part: "Part of €1,200 fixed fee · €600 remaining after this invoice".

### 4.4 Everywhere else

| Place | Shows |
|---|---|
| Task rate pill | `€1,200 fixed` · `€1,200 fixed · €600 billed` · `€1,200 fixed · billed` |
| Task row (Admin) | Tracked hours, and the effective rate when there are hours: "18.5h · €65/h effective" |
| *Ready to invoice* | The remaining fee is added to the client's unbilled amount |
| Client and Time stat strips "Unbilled" | Hourly unbilled + remaining fees |

### 4.5 Changes after billing

The task form always shows the money effect inline before Save (Brief principle 6). There is
no dialog.

| Change | Allowed? | Effect |
|---|---|---|
| Raise or lower the fee | Yes | `unbilled_fixed` is recalculated. If the new fee is below what was already billed, the form warns "€800 already billed. Nothing left to bill." Sent invoices never change |
| Hourly → Fixed | Yes | Billed entries stay on their invoices. Unbilled entries stop counting as hourly unbilled. The note says "12h of unbilled time (€1,080) will be covered by the fee instead" |
| Fixed → Hourly, nothing of the fee billed | Yes | Entries with `billable = true` become hourly unbilled. The note says "Bills 18.5h tracked so far (€1,665) at the hourly rate" |
| Fixed → Hourly, part of the fee billed | **No** | Disabled with: "€600 of this fee is on invoice 188. Add a new hourly task for the extra work." Otherwise the same work could be billed twice |
| Anything → Non-billable | Yes | Unbilled hourly time and the remaining fee leave unbilled totals. Billed lines are untouched |

## 5. Project budgets

A project can have one budget, either hours or money (Brief §6.1).

| Budget | Used = |
|---|---|
| **Hours** | All tracked seconds on the project's tasks, billable or not, in every billing mode. Written-off time counts: it was worked |
| **Money** | Billed: Σ `amount_minor` of `time` and `fixed` lines in the live version (§4.2) of non-void invoices for the project's tasks · plus unbilled hourly value at the current rates · plus `unbilled_fixed` of each fixed task. The result is the same as "Σ every fee in full + hourly value" |

- Written-off and billed-elsewhere time is **left out** of money used, since nothing is billed
  for it. It's still in the hours.
- Manual and discount lines don't count, because they aren't tied to a project.
- Colouring is warning at ≥ 80% and danger at > 100% (Guide §5.15).

## 6. Rounding

All rounding is **half away from zero**. For positive amounts, which are all of our data, this is
Paydirt's half-up (5.87 h × $32.50 = 190.775 → **$190.78**). We checked the rule against all
4,192 Paydirt rows: every price matches. Postgres `round(numeric)` uses the same rule, so SQL
and `@paypure/domain` agree, and a check constraint can verify line amounts.

The steps, in order. Each value is rounded once, at the point named, and never re-derived later.

| # | Value | Formula | Rounded to |
|---|---|---|---|
| 1 | Entry duration | Integer seconds, as stored. Never rounded in the database | — |
| 2 | Line quantity for time | `qty_hundredths = round(Σ seconds of the line's entries / 36)` (1 hundredth of an hour = 36 s) | 0.01 h |
| 3 | Line amount | `amount_minor = round(qty_hundredths × rate_minor / 100)` | 1 minor unit |
| 4 | Discount amount (percent) | `−round(Σ amount of non-discount lines × bp / 10000)` | 1 minor unit |
| 5 | Each tax | `round(Σ amount of the lines carrying that tax × bp / 10000)` | 1 minor unit |
| 6 | Subtotal | Σ line amounts (discount included) | exact |
| 7 | Total | subtotal + Σ taxes | exact |
| 8 | Balance | total − Σ payments. Below zero shows as "Overpaid $X" | exact |

- **The quantity is summed first, then rounded** (step 2). A *One per entry* line holds one entry,
  so it rounds exactly as Paydirt did. A grouped line can differ by a cent or two from the sum of
  its entries rounded one by one. Each line still checks out on a calculator, which is the
  promise (Brief §7.1).
- **One formula for every line kind.** Manual, fixed and discount lines also store
  `qty_hundredths` (1 = `100`) and `rate_minor`, and step 3 gives the amount. A check constraint
  holds `amount_minor = round(qty_hundredths::numeric * rate_minor / 100)`.
- **Taxes are per tax on the sum of lines, not per line** (step 5). This is how Paydirt computed
  them, the client sees one tax row per rate, and it avoids the per-line rounding drift that
  makes a tax row disagree with its own percentage.
- **The unbilled amount on Home and the stat strips** is computed as if each task were one line
  (steps 2–3 per task). The builder shows the exact figure for the chosen layout, which can differ
  by cents.

### 6.1 Duration rounding increments: not in v1

Paydirt offered "Round to nearest / Round up to N minutes" per invoice. Its default was off, and
our 7 years of data show no rounding (entries like 0.07 h). The builder's *Rounding* control is
**removed** from S9. `@paypure/domain` takes an optional increment parameter (default none), so it
can come back as a per-client setting without a schema change.

## 7. Taxes and discounts

### 7.1 Taxes

- Each invoice **version** has N taxes, copied from the workspace defaults when the draft is
  created, and copied from the base version when a correction opens:
  `invoice_version_taxes (id, version_id, name, rate_bp, position)`. Like lines, they freeze with
  the version (08 §3.3), so a correction can never change what an earlier revision charged.
- Each line carries any subset of them: `invoice_line_taxes (line_id, version_tax_id)`. A new line
  carries all of the invoice's taxes. The line's chips toggle them.
- Taxes are **exclusive** (added on top) and **never compound** (a tax is never charged on
  another tax), as in Paydirt. Inclusive and compound taxes are "later". The columns leave room
  for a `mode` enum.
- A tax with no lines carrying it is still printed, at `0.00`, so it's visible on the sheet. The
  editor warns about it.
- Reverse charge and other legal notes depend on Brief Q3 and are not modelled here.

### 7.2 Discount

- At most **one** discount line per invoice in v1, `kind = discount`, always shown last above the
  subtotal.
- It is either a fixed amount or a percentage. A percentage is turned into an amount at step 4
  and stored as `rate_minor` (negative) with `discount_rate_bp` kept for the label
  ("Discount 10%"). While the invoice is a draft, the amount follows the other lines. It freezes
  with the invoice (08).
- **The discount is applied before tax.** It carries the same tax chips as any line, by default
  all of the invoice's taxes, so it lowers each of those tax bases (step 5).
- A tax base can't go below zero, and the total can't go below zero. The editor shows an error on
  the discount line instead of saving.

## 8. Payment accounts

The bank details printed on an invoice.

### 8.1 Model

`payment_accounts`

| Column | Type | Notes |
|---|---|---|
| `id`, `workspace_id` | | |
| `currency` | `char(3)` | From the currency table (§1.1) |
| `label` | text | Shown only in pickers: "Mercury USD", "Wise USD" |
| `beneficiary_name`, `beneficiary_address` | text | |
| `bank_name`, `bank_address` | text | |
| `account_number`, `iban`, `swift_bic`, `routing_number` | text null | At least one of `account_number` / `iban` (check) |
| `correspondent_bank_name`, `correspondent_account`, `correspondent_swift` | text null | Intermediary bank for USD wires |
| `reference_hint` | text null | Shown and copyable on the public page only when set (Screens S15) |
| `instructions` | text null | Printed first, e.g. "Leave the reference and comment fields empty" |
| `is_default` | bool | **One default per currency**: `UNIQUE (workspace_id, currency) WHERE is_default AND archived_at IS NULL` |
| `archived_at` | timestamptz null | |

`clients.default_payment_account_id` (FK, null). It must be an account in the client's currency.
The service checks this, and the field is cleared if the client's currency changes.

### 8.2 Which account an invoice gets

While the invoice is a draft (or an open correction), the first match wins, read live:

1. The client's default account, if it is in the invoice currency and not archived.
2. The workspace default for that currency.
3. None. The draft shows a warning, "No payment account for USD · Add one", and the Send dialog
   repeats it. Sending is still allowed: some clients pay by card or cash.

The invoice version stores `payment_account_mode` (`default`: resolve as above · `account`: the
one the user picked · `none`), `payment_account_id` (for reporting) and
`payment_account_snapshot` (jsonb with every field above except `is_default` and `archived_at`).
The snapshot is NULL (read live) on a draft and written when the version freezes at send
([08 §3.2](08-invoice-lifecycle.md#32-what-freezing-means)). The snapshot is what prints. Editing an account never changes a sent
invoice.

### 8.3 Picker in the invoice editor (S11)

Lists the accounts in the invoice currency: label, bank, the last 4 characters of the account or
IBAN, and a `Default` tag. Archived accounts are hidden. There are also `None` and `Add account…`
options (the second opens Settings → Business in a new tab). Picking an account sets
`payment_account_mode = account`; picking `None` sets `none`. No snapshot is taken until send.

### 8.4 Archive vs delete

- An account that **any non-draft invoice** used can't be deleted, only **archived**. It leaves
  the pickers, and every invoice keeps its snapshot.
- An unused account can be deleted.
- Archiving a default leaves that currency without one until another account is marked default.
  The settings list says so.

### 8.5 Our migration

Both banks from the sample invoices become USD accounts. The newer one is the default. When the
invoice export arrives, each client's default is set to the account its latest invoice used
(05 §6).

## 9. Worked examples (copy into `@paypure/domain` tests)

| # | Case | Input | Expected |
|---|---|---|---|
| 1 | Seconds → hundredths | 3600 / 17 / 18 / 3617 / 3618 s | 100 / 0 / 1 / 100 / 101 |
| 2 | Paydirt half cent | 587 hundredths × 3250 | 19077.5 → **19078** ($190.78) |
| 3 | Paydirt sample | 102 hundredths × 6000 | **6120** ($61.20) |
| 4 | Grouping vs per entry | 3 entries of 627 s at 9000/h | Per entry: 3 × 17 = 51 → **4590**. One line: round(1881/36) = 52 → **4680** |
| 5 | Invoice with VAT | Lines 112500 + 279000 + 4000, VAT 1000 bp on all | Subtotal 395500 · VAT 39550 · Total **435050** (Guide §5.13 sheet) |
| 6 | Tax half | Base 12345, 1000 bp | 1234.5 → **1235** |
| 7 | Tax only on some lines | 100000 (taxed) + 4000 (not taxed), 2000 bp | Tax **20000** · Total 124000 |
| 8 | Discount before tax | Line 100000, discount 1000 bp, VAT 2000 bp on both | Discount −10000 · VAT 18000 · Total **108000** |
| 9 | Negative half | Discount 1000 bp on 12345 | −1234.5 → **−1235** |
| 10 | Fixed fee in parts | Fee 120000. Sent invoice bills 60000, a draft bills 30000 | Unbilled **30000**. Void the sent invoice → **90000**. Delete the draft too → **120000** |
| 11 | Fee lowered below billed | Fee 120000, billed 80000, fee set to 60000 | Unbilled **0** (not −20000) |
| 12 | Currency mismatch | Workspace EUR rate 9000, USD client with no rate | Resolves to **none** |
| 13 | JPY | 150 hundredths × ¥8000 (exponent 0) | **12000** (¥12,000) |
| 14 | Overpaid | Total 435050, payments 440000 | Balance **−4950**, shown "Overpaid €49.50" |

## 10. Unbilled, as SQL

This replaces the "Unbilled everywhere means…" line in Tech §5.2.

```sql
-- Hourly unbilled entries
time_entries.invoice_id IS NULL              -- the billing claim (08 §3.1)
AND time_entries.off_invoice IS NULL
AND time_entries.billable
AND time_entries.state = 'stopped'            -- live timers aren't unbilled yet (06 §2.2).
                                              -- Not ended_at: duration-only entries have none
AND time_entries.deleted_at IS NULL           -- soft-deleted (undo window, 06 §2.5)
AND tasks.billing_mode = 'hourly'

-- Unbilled fixed fees: §4.2, per task
```

The partial index on unbilled entries stays as in Tech §5.2. The billing mode is on `tasks`, so
the index can't include it, and it doesn't need to: the join is on a small table.

## 11. Decisions (please challenge)

| # | Decision | Alternative we rejected |
|---|---|---|
| M1 | Money is `integer` minor units, and SQL sums are cast to `::int` | `bigint` (JS `BigInt` breaks JSON), `numeric` (Prisma `Decimal` objects everywhere), floats |
| M2 | Half away from zero, rounded once per step (§6) | Banker's rounding (doesn't match Paydirt or our clients' invoices) |
| M3 | A time line's quantity is the sum of its seconds rounded once to 0.01 h | Round each entry, then sum (a line wouldn't check out as qty × rate) |
| M4 | Tax per tax on the sum of the lines carrying it | Tax rounded per line (drifts from its own percentage) |
| M5 | One discount line, applied before tax | Discount after tax, or many discount lines |
| M6 | No duration rounding increments in v1 | Paydirt's per-invoice "round to N minutes" |
| M7 | Time on fixed-fee tasks is covered by the fee: never hourly unbilled, never linked to lines | Paydirt's "Plus $X unbilled at hourly rates" mix on one task |
| M8 | Fixed fees bill in parts as separate `fixed` lines, and the remainder is derived from lines on non-void invoices | A stored `unbilled_fixed_value` counter (drifts on void and delete) |
| M9 | Fixed → Hourly is blocked once part of the fee is billed | Allowing it and risking double billing |
| M10 | The workspace default rate only applies to clients in the workspace currency | Inheriting the number across currencies |
| M11 | Several payment accounts per currency, one default per currency, an optional client default, and a frozen snapshot on the invoice | One account per currency (our two USD banks don't fit) |
| M12 | An explicit currency table in `@paypure/domain` | The exponent derived from `Intl` at runtime |

## 12. Left to implementation

- The exact list of v1 currencies beyond USD and EUR.
- Whether `iban` and `account_number` stay separate columns or become one field with a type.
- How the effective-rate figure on fixed tasks is labelled for Members (hidden, like all money).
- Whether *Ready to invoice* shows fixed fees on their own row or folds them into the client total.
- Overpayment follow-up (refund or credit) is not modelled. The balance just shows as overpaid.
