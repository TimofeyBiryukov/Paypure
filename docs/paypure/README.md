# Paypure

Paypure is our time-to-invoice app: track clients, projects and time on tasks, then turn the
unbilled time into an invoice and send it. It is based on what we learned from
[Paydirt](../paydirt/README.md) and cut down to that one job.

Internal first (our team), designed so it can later be offered to freelancers and small studios.

| # | Document | Read it for |
|---|---|---|
| 01 | [Product brief](01-brief.md) | What Paypure is, who it's for, scope (v1 / later / cut), domain model, invoice lifecycle, decisions and open questions |
| 02 | [Design guide](02-design-guide.md) | Visual language, tokens, components and their states, interaction rules, voice, accessibility |
| 03 | [Screens & flows](03-screens-and-flows.md) | Sitemap, a spec for each of the 17 screens, 6 key flows, design checklist |
| 04 | [Tech stack & architecture](04-tech-stack.md) | Services, libraries, data rules in Postgres, Docker dev/prod setup, resource budget, performance targets |
| 05 | [What the Paydirt data tells us](05-paydirt-data.md) | Findings from our own Paydirt export, what they changed, the migration plan, and a checklist to re-run when the invoice export arrives |
| 06 | [Time, timers & live sync](06-time-and-timers.md) | Entries as segments (pauses), the timer state machine, time zones end to end, live sync over SSE |
| 07 | [Money & billing rules](07-money-and-billing.md) | Money storage, rate resolution, fixed fees, rounding (Paydirt-compatible), taxes and discount, payment accounts, worked examples for tests |
| 08 | [Invoice lifecycle, corrections & sending](08-invoice-lifecycle.md) | Frozen versions, corrections as revisions, staged edits to billed time, numbering and dates, the send transaction and email outbox, payments, imported invoices |

## Paydirt → Paypure at a glance

| Paydirt | Paypure |
|---|---|
| Reports · Clients · Time · Quotes · Invoices + Settings | Home · Time · Clients · Invoices (+ Settings in the avatar menu) |
| 6 price types + "update unbilled time?" dialogs | 3 billing modes (Hourly / Fixed / Non-billable). The rate is inherited and frozen at invoicing |
| 325px tracker sidebar on every page | Timer pill in the top bar + ⌘K palette |
| Invoice grid of paper cards | Sortable table with due date, balance, status chip |
| Select whole tasks to invoice, server-rendered preview | Select individual entries, instant client-side preview |
| Edit a sent invoice → back to draft, payments deleted | Sent invoices frozen. Corrections are revisions of the same number, re-sent with what changed. Payments kept |
| Draft / Sent / Overdue / Paid | + Partially paid, Void. "Viewed" tracked as activity |
| Per-client number prefixes, number on creation | One sequence, number assigned on send (no gaps). We continue at 188 |
| One `paused_duration` total per entry (when the breaks were is lost) | Pauses are segments of one entry, so every break is on record and never billed |
| Stale unbilled time stays for ever | *Billed elsewhere* / *Written off*, reversible |
| Quotes, recurring, timesheets, integrations, extension | Cut (recurring and online payments are "later") |
| Desktop only | Responsive. The phone handles the timer and invoice status |

## Next steps

1. Answer the open questions in [01 §11](01-brief.md#11-open-questions), especially per-member
   rates and tax handling, because they change the data model. Where 01–05 and 06–08 differ on
   a detail, 06–08 are the more specific source. The data answers some of them
   provisionally ([05](05-paydirt-data.md)).
2. When Paydirt sends the invoice export (and quotes, if any), re-run the
   [05 §6 checklist](05-paydirt-data.md#6-re-run-checklist-when-the-invoice-export-arrives).
3. Turn [02](02-design-guide.md) tokens into a design-tool library and component sheet.
4. Answer the hosting and email questions in [04 §13](04-tech-stack.md#13-open-questions), then
   scaffold the repo (pnpm workspace, compose, both apps, `@paypure/domain`).
5. Design the hero flows first: **track a day** (S4, S2) and **month-end invoice** (S9, S11, S12).
