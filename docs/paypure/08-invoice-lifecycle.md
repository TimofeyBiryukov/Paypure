# 08 — Invoice lifecycle, corrections & sending

Status: draft v0.1 · 2026-11-23 · depends on [01 — Brief](01-brief.md) §7–§8,
[03 — Screens](03-screens-and-flows.md) S9–S15, [04 — Tech](04-tech-stack.md) §5,
[06 — Time](06-time-and-timers.md) (time zones), [07 — Money](07-money-and-billing.md) (amounts,
rounding, taxes, fixed fees, payment accounts)

This document is the source of truth for what happens to an invoice from draft to paid: how it
is frozen, how it is corrected, how it is sent and what is stored. Where 01, 03 or 04 say
something different, this document wins.

**The rule behind everything here:** once an invoice is sent, the document the client received
never changes. Any change made after that, by anyone, becomes a **correction**. The user reviews
the correction, approves it and sends it again. Nothing reaches the invoice or the client silently.

---

## 1. What Paydirt got wrong

| Paydirt behaviour ([05](../paydirt/05-invoices-quotes.md) §3, §4) | Consequence |
|---|---|
| "Convert invoice to draft" is the only way to change a sent invoice | The sent document is edited in place. There is no record of what the client originally got |
| Converting an invoice that has payments **deletes all its payments** | Money records disappear as a side effect of fixing a typo |
| An invoice with payments can't be edited at all | A paid invoice with a wrong address can't be fixed, except by deleting payments |
| The activity feed shows *Draft → modified → Sent* | You can see that something changed, but not what |
| Time entries billed on an invoice have no lock in the edit form ([04](../paydirt/04-time-tracking.md) §2) | Editing a billed entry can make the time and the invoice disagree with no warning |
| Line descriptions are built from entry notes when the invoice is created | Nothing ties the printed text back to its entries, so there's nothing to compare against |
| The number is assigned on creation and editable, with per-client prefixes | Duplicate and out-of-order numbers, plus gaps when drafts are deleted |
| The status is derived from a `sent` flag, with no partially paid or void state | A partly paid invoice looks the same as an unpaid one. There's no clean way to cancel |
| PDFs are rendered on demand from the current data | A re-download can differ from what was emailed |

Paypure fixes this with four mechanisms: **frozen versions** (§3), **corrections as revisions**
(§4), **staged changes to billed time** (§5) and a **send pipeline built around an outbox** (§7).

---

## 2. States

### 2.1 Stored vs derived

Only the parts of the state that people decide are stored. Everything that follows from
payments or dates is derived, so it can't drift.

| Field | Stored / derived | Values |
|---|---|---|
| `invoices.status` | **stored** | `draft` · `issued` · `void` |
| Payment state | derived from payments and the current version's total | `unpaid` · `partially_paid` · `paid` · `overpaid` |
| Overdue | derived | `issued` ∧ net paid < total ∧ `due_date` < today in the **workspace time zone** (06) |
| Viewed | activity, not a state | first and last view |
| Correction pending | derived: an unfrozen version exists on an issued invoice | banner, not a status |

The chip label shown everywhere (Guide §5.5) is chosen by one function, `displayStatus()`, in
`@paypure/domain`, and mirrored by an SQL view `invoice_summary`. The checks run in this order:
`void` → `draft` → `paid` (also covers overpaid, with an "Overpaid $X" note) → `overdue · Nd` →
`partially paid` → `sent`.

"Paid" is an event, not a state: when a payment takes net paid to the total or above, the
service logs a *Paid* activity. `paid_at` is the date of that payment and is derived.

### 2.2 Diagram

```
              send / mark sent                      correct (rev n+1 draft)
  ┌───────┐  (number, freeze rev 1)  ┌──────────┐ ───────────────────────────┐
  │ draft │ ───────────────────────▶ │  issued  │ ◀── approve: freeze rev n+1 ┘
  └───┬───┘                          └────┬─────┘     (send correction or save
      │ delete                            │            without sending)
      ▼                                   │ void (net payments = 0)
  (gone; entries released)                ▼
                                     ┌──────────┐
                                     │   void   │  number kept; entries released; terminal
                                     └──────────┘

  Payment state on an issued invoice (derived, moves both ways as payments are added/removed):
    unpaid ──▶ partially_paid ──▶ paid ──▶ overpaid      + overdue flag when past due and not paid
```

There are no backward transitions. `issued → draft` doesn't exist (it was Paydirt's main
failure). A void invoice stays void. To bill the same work again, build a new invoice.

---

## 3. Frozen versions

### 3.1 Model

The content of an invoice lives in **versions**. Version 1 is the draft until it is sent. Each
correction adds a version. A version is mutable until it is **frozen** (sent or marked sent), and
after that it can never change.

```
Invoice (number, status, client, currency, public token)
 ├─ InvoiceVersion rev 1  (frozen 1 Dec)   ← what the client got first
 ├─ InvoiceVersion rev 2  (frozen 3 Dec)   ← current_version_id
 │   ├─ InvoiceLine[]  ── InvoiceLineEntry[] ──▶ TimeEntry
 │   └─ InvoiceFile (PDF bytes + sha256)
 ├─ InvoiceVersion rev 3  (unfrozen)       ← open correction (max one)
 │   └─ InvoiceEntryChange[]               ← staged edits to billed entries (§5)
 ├─ Payment[]          (belong to the invoice, not to a version)
 ├─ OutboundEmail[]    (§7)
 └─ InvoiceActivity[]  (append-only)
```

| Table | Key columns | Notes |
|---|---|---|
| `invoices` | `id`, `workspace_id`, `client_id`, `status`, `number` text null, `number_seq` int null, `number_period` text null, `currency`, `current_version_id` null, `public_token_hash`, `source` (`paypure`·`paydirt`), `voided_at`, `voided_by`, `void_reason` | `UNIQUE (workspace_id, number)`, `UNIQUE (workspace_id, number_period, number_seq)`. Check: `number IS NULL ⇔ status = 'draft'` |
| `invoice_versions` | `id`, `invoice_id`, `rev`, `frozen_at` null, `frozen_by`, `issue_date`, `due_date`, `terms_days`, `summary`, `notes`, `from_snapshot`, `to_snapshot`, `payment_account_mode`, `payment_account_id`, `payment_account_snapshot` (jsonb, 07 §8; all three snapshots NULL = live until frozen, §3.2), `line_layout` (jsonb), `subtotal`, `discount_total`, `tax_total`, `total` (minor units, written at freeze), `change_summary` (required for rev ≥ 2), `content_hash`, `template_version` | `UNIQUE (invoice_id, rev)`. Partial unique `(invoice_id) WHERE frozen_at IS NULL`: at most one open version |
| `invoice_lines` | `id`, `version_id`, `position`, `kind` (`time`·`fixed`·`manual`·`discount`), `title`, `detail` (Markdown, e.g. the entry note), `qty_hundredths`, `unit`, `rate_minor`, `amount_minor` (07 §6), `discount_rate_bp` null (07 §7.2), `task_id` null (fixed fees, see 07), `overrides` (jsonb: which fields the user edited by hand), `source_fingerprint` | All text is **copied** onto the line. Nothing on a line reads live from the entry |
| `invoice_version_taxes` | `id`, `version_id`, `name`, `rate_bp`, `position` | Per version, copied into a correction (07 §7.1) |
| `invoice_line_taxes` | `line_id`, `version_tax_id` | Which of the version's taxes a line carries |
| `invoice_line_entries` | `line_id`, `time_entry_id`, `seconds` | Which entries a line bills, per version. History survives revisions |
| `invoice_entry_changes` | `version_id`, `time_entry_id`, `op` (`update`·`delete`·`move`), `changes` jsonb `{field: [old, new]}`, `segments` jsonb null (the full new segment list for a timed entry, 06 §2.2) | Staged edits, applied when the version freezes (§5). One row per entry per version |
| `invoice_files` | `version_id` PK, `kind` (`rendered`·`imported_original`), `pdf` bytea, `sha256`, `bytes`, `template_version`, `rendered_at` | Written once |
| `payments` | `id`, `invoice_id`, `kind` (`payment`·`refund`), `amount` > 0, `received_on`, `method`, `note`, `created_by`, `deleted_at`, `deleted_by` | Soft-deleted only by a person, with undo. Never by the system |
| `invoice_activity` | `id`, `invoice_id`, `version_id` null, `kind`, `actor` (member · system · client), `data` jsonb, `at` | Append-only |
| `time_entries.invoice_id` | FK null | **The billing claim.** Replaces `invoice_line_id` (Tech §5.2). Check: exclusive with `off_invoice` |

**Why a claim on the entry plus links per version.** "Billed" has to be a cheap,
uniquely enforced fact (`invoice_id IS NOT NULL`), so an entry can never sit on two invoices.
Which *line* bills an entry can differ between revisions, so that link lives per version in
`invoice_line_entries`. A plain `invoice_line_id` on the entry can't do both.

### 3.2 What freezing means

Freezing a version happens in the send transaction (§7.2). It:

1. Fills the snapshots: the business (From), the client (To) and the payment account. On an
   unfrozen version each snapshot column has one meaning: **NULL = read live**, **non-NULL =
   pinned** (edited by hand, or carried over by a correction). Freezing fills every NULL from the
   live data. So a new draft never holds stale details, and nothing changes on a correction
   unless the user asks. The account choice is `payment_account_mode` (`default` · `account` ·
   `none`) plus `payment_account_id`, so "None" is stored explicitly (07 §8.2).
2. Computes the totals with `@paypure/domain` (07) and writes them to the version.
3. Writes `content_hash` = sha256 of the canonical JSON of the version and its lines, and
   `template_version` (the sheet component's version).
4. Sets `frozen_at` and `frozen_by`.

The PDF is rendered **after** the commit (it needs the committed number) and stored once in
`invoice_files`. It is never re-rendered, even when the sheet template changes later. A
download always returns those bytes. If the render failed and there are no bytes yet, the job
renders from the frozen data with the pinned `template_version`.

### 3.3 Enforced in the database

The service checks these rules, and Postgres enforces them again, so a bug or a manual query
can't break them. The app connects as a role that doesn't own the tables, so it can't disable
the triggers.

| Trigger | Rule |
|---|---|
| `invoice_versions_frozen` | `BEFORE UPDATE OR DELETE`: if `OLD.frozen_at IS NOT NULL`, raise. (Freezing itself is allowed, because at that point `OLD.frozen_at` is null) |
| `invoice_children_frozen` | `BEFORE INSERT/UPDATE/DELETE` on `invoice_lines`, `invoice_version_taxes`, `invoice_line_taxes`, `invoice_line_entries`, `invoice_entry_changes`: if the parent version is frozen, raise |
| `invoices_guard` | `number`, `number_seq`, `client_id` and `currency` can't change once a number is set. Status can only go `draft→issued` or `issued→void`. `DELETE` is only allowed while `draft` |
| `invoice_files_write_once` | No `UPDATE`. No `DELETE` |
| `invoice_activity_append_only` | No `UPDATE`. No `DELETE` |
| `time_entries_billed_guard` | `BEFORE UPDATE`: if the entry's `invoice_id` points to an `issued` invoice and any **billed field** changes (date, start, end, duration, task, billable, `deleted_at`, and the note when it's printed, §5.1), raise. The same guard sits on `time_entry_segments` (`INSERT/UPDATE/DELETE` for a claimed entry). The only exception is when the transaction has set `SET LOCAL paypure.applying_version = '<version id>'` and the change matches a staged row for that version |

---

## 4. Corrections

### 4.1 Revision, not void + new number

| | (a) Void + replacement with a new number | **(b) Revision of the same number** ✔ |
|---|---|---|
| What the client sees | Two invoices: one void and one new. "Which one do I pay?" | One invoice, *Revision 2*, with a "what changed" note |
| Numbers | Burns a number per correction | No number used. The sequence stays clean |
| Payments | Have to be moved between invoices | Stay on the invoice. The balance is recalculated |
| Time entries | Released, then claimed again (they bounce through unbilled) | The claim stays. Only the entries a correction removes are released |
| Audit trail | Spread over two records | Every version is kept, with its PDF, its hash and the email it went out with |
| EU VAT (later) | This is how credit notes work | Not allowed for VAT invoices in most EU states |

**Decision:** corrections are **revisions** (b). Our clients are abroad and mostly outside VAT
rules, and (b) is the clean experience the user asked for. For EU users later, the same
correction is approved through a workspace setting, `correction_style = credit_note`: approving
then issues a credit note (its own number, cancelling the old total) plus a new invoice. It would add
`invoices.corrects_invoice_id`. It isn't built in v1, and the column isn't added until then.

### 4.2 The correction flow

1. On an issued invoice: `Correct invoice` (the primary action in the lock banner, S11). This
   creates `rev n+1` as an **open version**: a copy of the current frozen version with its lines,
   line–entry links, taxes and snapshots. The snapshots are carried over **pinned** (§3.2): a typo
   fix never switches the address or bank details. The changes panel offers *Refresh client,
   business and payment details*, which un-pins them, and the diff shows what that changes.
2. The same editor as a draft opens, with the header *"Correction to 188 · revision 2"* and a
   **changes panel**: changed, added and removed lines, staged entry edits (§5), and totals
   before → after.
3. *What changed* is a short text, prefilled from the diff ("Line 4: 3.50 h → 2.50 h. Total
   $2,307.60 → $2,242.60"). It is required, and it is printed in the correction email and on the
   public page's history.
4. Approve, with one of:
   - **Send correction** → S12 with the *Correction* template, which attaches the new PDF; or
   - **Save without sending** (the client has been told some other way) → no email, but an
     activity is logged.
   Both run the freeze transaction (§7.2) with no new number.
5. **Discard correction** deletes the open version and its staged changes, and releases only the
   entries this correction added. The invoice is exactly as it was.

The rules for a correction:
- The number and the issue date stay. The sheet shows *"Revision 2 · revised 3 Dec 2026"* under
  the number. The due date stays unless the user edits it.
- The client and the currency can't change. To send the invoice to a different client, void it
  and build a new invoice.
- Unbilled entries can be added. They're claimed as soon as they're added, as on a draft.
  Entries the correction removes are released when it is approved.
- Payments recorded while a correction is open apply to the invoice as usual.
- The public link always shows the latest frozen version, with a *Previous versions* list (date,
  what changed, PDF).
- Imported invoices can't be corrected (§9).

### 4.3 Void

Void is **cancellation**, not correction. Use it when the whole invoice was a mistake: the wrong
client, sent twice, or the work won't be billed.

- It is allowed only when net payments are 0. Otherwise the button is disabled with the tooltip
  *"Refund or remove the payments first, or correct the invoice instead."* (This replaces the
  "move payments to the copy" option in S14.)
- Every claimed entry is released (back to unbilled). The number stays, struck through.
- The public page shows "This invoice was voided".
- After voiding, a banner says *"14 entries are unbilled again · Create invoice"*.

### 4.4 Duplicate (the only "copy" action)

*"Void and create a corrected copy"* is removed: corrections are revisions now. There is one copy
action left.

| Duplicate (any status, including void and imported) | |
|---|---|
| Result | A new **draft**, with no number |
| Client · currency | The same |
| Lines | All copied as **manual** lines with the same title, detail, qty, unit, rate and taxes. **No time links** |
| Summary · notes · taxes · line layout | Copied |
| Dates | Issue date empty (it's set on send). Due date from terms |
| Snapshots · payment account | Live (the client's current default account) |
| Payments · activity · emails | None |
| Banner | When the source had time lines: "Copied as fixed lines · Replace with unbilled time" |

This is the monthly fixed-invoice path (F7). *(Optional nicety: when a line contains a `MM-YYYY`
or month name, offer "Update to 11-2026".)*

---

## 5. Changes to billed time and other sources

### 5.1 Which entry fields are "billed"

The date, start, end, duration, task and billable flag always affect the document (qty, grouping,
date ranges). The **note** affects it only when the version's line layout prints entry notes
(*One per entry*, or "Show entry notes" ticked). `affectsDocument(entry, version)` in
`@paypure/domain` decides this.

### 5.2 Rules by where the entry is billed

| Entry is… | Editing a billed field |
|---|---|
| Unbilled | Saves normally |
| On a **draft** (rev 1 not sent, or an open correction) | Saves normally. The draft's lines are copies, so they go **out of date**. The draft shows *"2 lines out of date · Update"*. Update regenerates qty and text from the entries and keeps fields the user overrode by hand (`overrides`). Nothing refreshes by itself, so a draft never changes under the user's eyes |
| On an **issued** invoice | **Staged.** The entry panel shows the current values read-only, with `Propose change`. Saving writes an `invoice_entry_changes` row on the invoice's open correction (creating one if needed). The entry itself doesn't change. The toast says *"Change added to the correction for 188 · Review"*. The entry shows a `Change pending` tag. The invoice shows *"1 change pending · Review and send"* |
| On a **void** invoice | It isn't billed: void released it |
| Billed elsewhere / written off | Saves normally (no document involved) |

When the correction is approved, the freeze transaction regenerates the affected lines, sets
`paypure.applying_version`, writes the staged values to the entries and freezes the version, all
at once. If the correction is discarded, the staged changes go and the entries keep their billed
values. **Time history and the invoice always agree.**

Deleting a billed entry (`op = delete`) or moving it to another task (`op = move`) is staged the
same way. When applied: a delete soft-deletes the entry and releases its claim; a move to a task
of the **same client** keeps the claim and regenerates the lines; a move to **another client**
releases the claim, so the entry becomes unbilled for its new client. Both show in the changes
panel ("removed from line 4").

### 5.3 Changes to other sources

| Change | Effect on drafts | Effect on issued invoices |
|---|---|---|
| Client details (name, address, tax ID, emails) | Applied live (§3.2) | None. The invoice page shows a quiet note, "Client details changed since sending · Include in a correction", which opens a correction with the details refreshed |
| Business profile, logo | Applied live | None. Same note |
| Payment account edited | Applied live | None. Same note |
| Rate (task, project, client) | Time lines go out of date → *Update* | None, ever (D1) |
| Fixed fee amount (07) | Fixed line goes out of date → *Update* | None |
| Template or design change | Applied live | None. The stored PDF bytes are what gets served |

---

## 6. Numbering and dates

### 6.1 Format

| Token | Output |
|---|---|
| `{seq}` | 7, 188 |
| `{seq:N}` | zero-padded to N digits: `{seq:3}` → 007, 188 · `{seq:4}` → 0042 |
| `{YYYY}` · `{YY}` | The year of the **issue date** |
| Any other text | Literal |

- `invoice_sequences (workspace_id, period, next_seq)`, with `period` = `''` when the sequence
  never resets, or `'2026'` when it resets yearly. A setting `reset: never | yearly`.
- The format must contain `{seq…}`, and a yearly reset requires `{YYYY}` or `{YY}` in the format.
- **Defaults:** new workspaces use `INV-{YYYY}-{seq:4}` with a yearly reset. **Ours uses
  `{seq:3}`, never reset, next 188.** It prints `188` today and matches Paydirt's zero-padded
  look for the imported `005`–`099` (it replaces `{seq}` in D9, with the same output for
  numbers ≥ 100).
- `number` stores the formatted text and `number_seq` the integer, so uniqueness covers both.
  Imported `"005"` is stored with `number_seq = 5` and `source = paydirt`.
- The next number in Settings can only be set **above** the highest `number_seq` used in its
  period. Raising it (which leaves a gap on purpose) is logged as a settings activity.

### 6.2 Issue date and order

- The number, the issue date and the due date are set **at send** (or mark sent). The issue date
  defaults to today in the workspace time zone (06).
- The user can set a different issue date in the draft's side panel, within these bounds:
  **not before the latest issued invoice's issue date** in the same sequence, and **not after
  today**. This keeps numbers in date order, which is what makes gapless numbering mean
  something.
- Due date = issue date + terms, unless it was set by hand.

---

## 7. Sending

### 7.1 Actions that end in a frozen version or an email

| Action | Freezes? | Number? | Email kind |
|---|---|---|---|
| Send invoice (draft) | rev 1 | assigned | `invoice` |
| Mark as sent (draft) | rev 1 | assigned | — |
| Send correction | rev n | kept | `correction` |
| Save correction without sending | rev n | kept | — |
| Resend (issued) | — | — | `invoice` (current version) |
| Send reminder (issued, unpaid) | — | — | `reminder` |
| Thank-you (after a payment) | — | — | `thank_you` |
| Send test to me (draft or open correction) | — | — | `test` |

### 7.2 The send transaction (T1)

`POST /v1/invoices/:id/send`, called by the S12 Server Action. The form carries a hidden
`idempotency_key` (a UUID made when the dialog opens), so a double submit returns the first
result.

1. `SELECT … FOR UPDATE` on the invoice. Check: draft or open correction exists, at least one
   line, total ≥ 0, a recipient, every template variable resolved. A missing payment account
   only warns (07 §8.2): some clients pay by card or cash.
2. **First send only:** `UPDATE invoice_sequences SET next_seq = next_seq + 1 … RETURNING`, then
   format the number (§6.1) and set `issue_date` and `due_date` (§6.2).
3. Apply the staged entry changes and release removed entries (corrections only, §5.2).
4. Freeze the version (§3.2). Set `invoices.status = 'issued'` and `current_version_id`.
5. **Render the email now** from the template and the frozen data (subject, text, HTML), and
   insert an `outbound_emails` row with `status = 'queued'` and the idempotency key. The email is
   frozen too: retries send exactly these bytes.
6. Insert the activity (*Sent to jane@… · rev 1*).
7. Queue the pg-boss jobs `invoice.render` and `email.deliver` **inside the same transaction**
   (pg-boss `send` with the transaction as `db`).
8. Commit. The dialog closes and the invoice is **issued** from now on, whatever happens to the
   email.

If T1 fails, everything rolls back: no number used, nothing frozen, no email.

### 7.3 After the commit (jobs)

| Job | Steps | Idempotent because |
|---|---|---|
| `invoice.render` | Gotenberg loads the signed print route for the **version id** (Tech §5.5) → store `invoice_files` (bytes, sha256) | `version_id` is the PK. If a row exists, the job skips |
| `email.deliver` | Waits until the PDF exists (state `waiting_for_pdf`) → builds MIME with nodemailer → sends through `MAIL_TRANSPORT` → sets `sent` and `sent_at`, or `failed` with `last_error` | Runs under a row lock (`FOR UPDATE SKIP LOCKED`). An email already `sent` is a no-op. `Message-ID` is fixed (`<email-id@paypure>`), so a repeat after a crash can be recognised |

pg-boss retries 5 times with backoff. After that, the activity shows **Failed · Retry**, and Retry
queues the same email again (no new row, no new number).

### 7.4 Transports

| `MAIL_TRANSPORT` | Use | Behaviour |
|---|---|---|
| **`log`** (default, v1) | First implementation | Writes one pino record per email at `info` on the `mail` logger: `email_id`, `kind`, `invoice`/`rev`, `message_id`, `from`, `reply_to`, `to`, `cc`, `subject`, **full `text`**, **full `html`**, and attachments as `{name, bytes, sha256}`. Marks the email `sent` with `transport = log` |
| `smtp` | Mailpit in dev (to see the HTML rendered), the provider later | nodemailer SMTP |

Whatever the transport, the stored `outbound_emails` row is the record. Every email activity in
S11 opens a read-only view of exactly what was sent (headers, body, attachment names and
hashes), so it can be checked in the app as well as in the logs.

`outbound_emails`: `id`, `workspace_id`, `invoice_id` null, `version_id` null, `kind`,
`idempotency_key` UNIQUE, `from`, `reply_to`, `to[]`, `cc[]`, `subject`, `text_body`,
`html_body`, `attachments` jsonb, `status` (`queued`·`waiting_for_pdf`·`sent`·`failed`),
`attempts`, `last_error`, `transport`, `message_id`, `queued_at`, `sent_at`, `created_by`. Only
the delivery columns can be updated. The same table carries invites and password resets.

### 7.5 Edge cases

- **Send test to me** renders the open version with a diagonal *DRAFT · not a valid invoice*
  watermark and "Draft" in place of the number. It goes to the current member only. No freeze, no
  number, and the PDF is attached but not stored in `invoice_files`.
- **Resend and reminders** attach the current frozen version's stored PDF. The PDF carries no
  payment state (Guide §5.13), so the reminder email body states the live balance
  (`{{balance}}`, `{{paid}}`). A reminder is offered
  when the invoice is overdue (and always from `⋯`).
- **Correction email** includes `{{changes_summary}}` and says the new version replaces the
  earlier one.
- **Sending to yourself** isn't special-cased: the To field is explicit, and "Send test to me" is
  the safe path.

---

## 8. Payments

- Payments and refunds belong to the **invoice**, so they survive every revision.
- Net paid = Σ payments − Σ refunds (excluding soft-deleted ones). Balance = current total − net
  paid.
- Overpayment is allowed with a warning. The invoice shows *Paid · overpaid $200*, and the fix is
  to record a refund (later: credit towards the next invoice).
- Removing a payment is a person's action (undo toast, *Removed payment* activity). The payment
  state is recalculated. The system never removes payments.
- Payments can be recorded on any issued invoice, including imported ones, but not on a draft or a
  void invoice.

---

## 9. Imported Paydirt invoices

| Option | Verdict |
|---|---|
| Lines from the invoice export, with entries linked per line | Best fidelity, but depends on an export we don't have yet, and matching lines to entries is guesswork |
| One synthetic line per invoice, with entries linked to it | Invents document content that never existed |
| **An `invoice_id` claim on the entries, plus lines only if the export has them** ✔ | Uses the claim from §3.1. "Billed on 184" is exact without any line mapping |

**Decision:**
- Each Paydirt invoice becomes an `invoices` row with `source = paydirt`, status `issued` or
  `void`, the original number text and `number_seq`, and one **frozen rev 1**: dates, totals,
  snapshots from the export, and its lines if the export has them (with no line–entry links).
- The **original Paydirt PDF** is stored as `invoice_files.kind = imported_original`. The app
  serves it and never re-renders imported invoices.
- Time entries billed on it get `invoice_id` = the imported invoice. `invoice_line_entries` is
  empty for imported versions. The send/freeze service requires links for every `time` line
  unless `source = paydirt` (a CHECK can't look at other rows).
- **Until the export arrives:** no stub invoices. Billed entries are *Billed elsewhere* with
  reference `Paydirt #NNN` (05 §4). When the export arrives, the idempotent migration script
  creates the invoices and converts those references into `invoice_id` claims.
- Imported invoices can receive payments and be duplicated. They can't be corrected. Void is
  allowed (net payments 0).

---

## 10. Public link and "Viewed"

- One token per invoice (128-bit random, stored **hashed**). It always shows the latest frozen
  version, plus *Previous versions*. *Regenerate link* revokes the old one. Headers:
  `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`.
- **Viewed is recorded by a beacon, not by the GET.** Email security scanners (Outlook Safe
  Links, Mimecast) fetch every link. So the page sends `navigator.sendBeacon` to a route handler
  once it has been visible for 2 s. A PDF download from the public page also counts.
- Views by a signed-in member of the workspace aren't logged.
- The activity stores the first view, the last view, a count, and which revision was viewed.

---

## 11. Clients with invoices

A client with any `issued` or `void` invoice (imported ones included) **can't be deleted**. The
menu offers *Archive* instead, with the tooltip "Clients with sent invoices are kept for your
records." A client with only drafts can be deleted with a confirm that names what goes with it.

---

## 12. Worked scenarios

**Fix a typo in a sent invoice.** Invoice 188 (rev 1) was sent on 1 Dec with "Genral development"
in the summary. `Correct invoice` → rev 2 opens with the changes panel. Fix the summary → *What
changed* is prefilled "Summary updated" → `Send correction` → S12 (Correction template) → send.
T1 freezes rev 2, with no new number and the issue date still 1 Dec. The client gets "Invoice 188
has been updated" with the new PDF. The public page shows rev 2 with rev 1 under *Previous
versions*. Nothing about the payments changed.

**Edit a billed entry's note.** An entry from 14 Nov is on 188 (*One per entry*, notes printed).
In Time, the panel shows it read-only with `Propose change`. Edit the note → Save → it is staged
on 188's correction (rev 2 created). The entry shows `Change pending`, and the invoice shows "1
change pending · Review and send". On approval, the entry note and line 9 change together in T1.
If the layout didn't print notes, the note would just have saved.

**Client paid half, then a correction lowers the total.** 188 has a total of $4,000 and $2,000
paid (partially paid). The correction removes 10 h, so the new total is $1,500. The changes panel
warns: *"Paid $2,000 is more than the new total $1,500. It will be overpaid by $500."* Approve →
the status is *Paid · overpaid $500*, and the 10 h go back to unbilled at freeze. The next step is
`Record refund` (or keep the credit for the next invoice, later). No payment was touched.

**Sent to the wrong client.** 189 went to Acme instead of Globex, with no payments. `Void` → the
entries are released → the banner says "14 entries are unbilled again". If the time was also
logged on the wrong client's tasks, move it in Time (Bulk → Move to task), then create Globex's
invoice from the builder. 189 stays void in the list, with its number struck through.

---

## 13. Decisions (please challenge)

| # | Decision | Alternative we rejected |
|---|---|---|
| L1 | A sent invoice is an immutable **version**. Corrections are revisions of the same number with a required "what changed" note | Void + replacement with a new number (two invoices for the client, numbers burned). Paydirt's convert to draft |
| L2 | Immutability is enforced by Postgres triggers, as well as by the service | A service-level guard only |
| L3 | Billing claim `time_entries.invoice_id`, plus line–entry links per version | `time_entries.invoice_line_id` (can't survive revisions) |
| L4 | Edits to entries billed on an issued invoice are **staged** in the correction and applied when it's approved | Edit the entry and regenerate the invoice silently. Or block all edits |
| L5 | Stored status `draft·issued·void`. Payment state and overdue are derived | Storing paid / partially paid (drifts from the payments) |
| L6 | The number and the issue date are set in the send transaction. The issue date can't be before the last issued one | A number on creation (Paydirt). Free-form issue dates |
| L7 | The email is rendered and stored at queue time and delivered from an outbox job. `MAIL_TRANSPORT=log` in v1 | Sending inside the request. Rendering at delivery time |
| L8 | One PDF per version, rendered after the commit, stored with sha256, never re-rendered | Rendering on demand (output drifts with template changes) |
| L9 | Void = cancellation, only with net payments 0. Entries are released | Void with "move payments to the copy" |
| L10 | Drafts read snapshots live. Time lines on drafts are copies with an explicit *Update* | Snapshot at draft creation (stale), or auto-refreshing lines |
| L11 | One copy action, **Duplicate**: manual lines, no time | Duplicate plus a "corrected copy" with different rules |
| L12 | Imported invoices: a frozen rev 1 with the original PDF and an `invoice_id` claim | A synthetic line. Stub invoices before the export |
| L13 | Yearly reset is optional. Ours is `{seq:3}` with no reset | One fixed format |
| L14 | Viewed = a JS beacon after 2 s of visibility, excluding members | Logging on GET (scanners make it lie) |

## 14. Left to implementation

- Canonical JSON for `content_hash` (key order, number encoding).
- The exact diff format in the changes panel and the wording of the prefilled *What changed*.
- How *Update* treats a line the user split or merged by hand. Default: it leaves such lines
  alone and lists them.
- Wording of the email templates for correction, reminder and thank-you.
- Whether `log` transport writes the HTML body at `info` or `debug` level in production.
- Credit-note mode (`correction_style = credit_note`) for EU workspaces.
