# Paypure (prototype)

A first implementation of the design in [`docs/paypure`](docs/paypure/README.md): track time on
client → project → task, turn unbilled time into an invoice, send it, and get paid.

## Run it

```bash
docker compose up -d
docker compose exec api sh -c "cd api && pnpm cli seed:demo"
```

Open http://localhost:3000 and sign in as `admin@example.com` / `paypure-demo` (Admin) or
`member@example.com` / `paypure-demo` (Member). The demo workspace continues Paydirt's numbering,
so the first invoice gets number **188**.

Optional: `docker compose --profile tools up -d adminer` (DB UI on :8081). Emails use
`MAIL_TRANSPORT=log`: each one is written in full to the API log (`docker compose logs api`).

Checks: `bash scripts/agent/check.sh` runs lint, typecheck and tests on the host. Add `--full`
for production builds. CI runs the same checks on every PR, plus migrations against a fresh
Postgres.

## Working with agents

Agents work in parallel, each in its own git worktree with its own branch, ports and database,
and merge their own PRs once CI passes. The rules are in [`AGENTS.md`](AGENTS.md).

```bash
claude -w fix-rounding            # Claude Code: worktree + setup, one per task
scripts/agent/new.sh fix-rounding # any other agent: creates and sets up the worktree
scripts/agent/prune.sh --list     # every worktree with its PR state and stack
scripts/agent/prune.sh --yes      # remove worktrees (and stacks) whose PRs are merged
```

Hooks keep agents out of this checkout. To let an agent work here, start it with
`PAYPURE_PRIMARY=1 claude`.

## Layout (Tech §3)

| Path                    | What                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`       | `@paypure/domain`: money (integer minor units, half-away rounding), currency table, rate resolution, line building and totals, `displayStatus()`, numbering, time zones, zod schemas. Tests cover every worked example in 07 §9                                                                                             |
| `api`                   | NestJS 11 on Fastify, Prisma 7 + Postgres 18. Modules: auth (argon2id, opaque DB sessions), catalog, time + timer, invoices (builder, drafts, send transaction, corrections, void, duplicate, payments), public/print, settings, live-sync events (pg_notify → LISTEN → SSE), outbox worker, PDF via Gotenberg              |
| `api/prisma/migrations` | Schema plus the rules Prisma can't express: one live timer per member, non-overlapping segments (btree_gist), fixed-fee and payment-account checks, line-maths check, and the immutability triggers (frozen versions, write-once PDFs and activity, billed-time guard). The app connects as `paypure_app`, a non-owner role |
| `client`                | Next.js 16 BFF: the browser only talks to Next; server components and Server Actions call the API. Every data commit is a real `<form>` (Guide §7)                                                                                                                                                                          |

## What works

- **Track (F2):** timer pill on every page with pause/resume (segments; breaks never count), stop with undo, start in the past, no-task timers, ⌥T and ⌘K palette; Time week/day/list views with gap rows and Fill, the entry panel (start–end or duration, smart time/duration parsing, per-segment editing, DST checks), bulk actions, take off unbilled (written off / billed elsewhere) with restore.
- **Invoice (F3):** Home "Ready to invoice", builder with per-entry selection, three line layouts and a live client-side preview, fixed fees billed in parts, draft editor with autosave, taxes, discount, payment account choice, send dialog with templates and idempotency key. The number is assigned on send in one transaction, the version and its snapshots are frozen, the PDF is rendered once and stored, and the email goes through the outbox.
- **Get paid / fix (F4, F5, F7, F8):** payments and refunds with undo, derived status chips (partially paid, overdue, overpaid), reminders, corrections as revisions of the same number with a "what changed" note, edits to billed time staged on the correction, void (blocked while paid), duplicate, public invoice page with viewed beacon and previous versions.
- **Catalog and settings:** clients, projects, tasks with rate inheritance pills and budgets; business profile, payment accounts, numbering, default taxes, email templates, members and invites, profile.
- **Live sync:** changes appear in other tabs and devices through `/events` (one EventSource per browser, BroadcastChannel to other tabs).

## Prototype shortcuts (differences from the docs)

- **Jobs:** an in-process outbox loop over `outbound_emails` and unrendered versions (Postgres is still the queue, `FOR UPDATE SKIP LOCKED`) instead of pg-boss. No overdue-notify, purge or session-cleanup crons yet.
- **Email:** `MAIL_TRANSPORT=log` only; SMTP/Mailpit isn't wired.
- **Public link token** is stored in plain text so admins can copy it; the docs ask for it hashed.
- **Invites** return a link to copy instead of sending an email; password reset isn't built.
- **Not built:** Paydirt CSV migration (05 §4), logo upload, task reordering, duplicate project, "Add unbilled time" into an existing draft, inline "Create task" in the picker, i18n keys (next-intl), Playwright and API e2e tests, prod compose (Traefik, backups).
- Dev memory limits for `api`/`client` are higher than the prod budget in Tech §9 (`next dev` needs more).
