# 04 — Tech stack & architecture

Status: draft v0.2 · 2026-11-23 · depends on [01 — Brief](01-brief.md),
[02 — Design guide](02-design-guide.md), [03 — Screens & flows](03-screens-and-flows.md) and
[06](06-time-and-timers.md)–[08](08-invoice-lifecycle.md)

How Paypure is built and run: the services, the libraries, the dev setup, and the rules that keep
it fast and cheap to host. The aim is a small, fast app that runs on a single 2 GB VPS with room
to spare.

---

## 1. Ground rules

| # | Rule | What it means in practice |
|---|---|---|
| R1 | **Everything runs in Docker** | No host Node, no host Postgres. Tests, lint, migrations all run with `docker compose exec …` |
| R2 | **One `docker compose up` starts the whole system** | A fresh clone with no `.env` boots: every variable has a working dev default |
| R3 | **Minimal resources** | No Redis, no queue broker, no object store, no PM2. Postgres does storage, sessions and jobs. Each container has a memory limit (§9) |
| R4 | **Separate API and client apps** | `api/` (NestJS) and `client/` (Next.js) are separate apps, images and containers |
| R5 | **The client's server talks to the API** | Next.js calls the API over the internal Docker network. **The browser never calls the API.** In production the API has no public port |
| R6 | **Postgres is the only datastore** | Business data, sessions, job queue, generated PDFs |

---

## 2. Architecture

```
                         Internet
                            │ :443
                     ┌──────▼──────┐
                     │   traefik   │  TLS (Let's Encrypt), only public entrypoint      (prod only)
                     └──────┬──────┘
                            │ :3000
                ┌───────────▼───────────┐
   browser ───▶ │ client  (Next.js SSR) │  pages, Server Actions, /i/:token public invoice,
                │                       │  /events (SSE, proxied from the API)
                └───────────┬───────────┘
                            │ http://api:4000   (internal network, Bearer session token)
                ┌───────────▼───────────┐          ┌─────────────────────┐
                │ api     (NestJS)      │ ───────▶ │ gotenberg (Chromium)│  HTML → PDF
                │  · REST /v1, SSE      │ ◀─────── │ internal only       │
                │  · jobs (pg-boss)     │          └─────────────────────┘
                │  · mail (outbox)      │ ───────▶  MAIL_TRANSPORT: log (v1) · smtp (Mailpit / provider)
                └───────────┬───────────┘
                            │ :5432
                ┌───────────▼───────────┐
                │ postgres 18           │  data · sessions · job queue · PDFs · LISTEN/NOTIFY
                └───────────────────────┘
```

This is the **backend-for-frontend** pattern. Next.js is the only thing the browser talks to:

- **Reads**: React Server Components fetch from the API during SSR and stream HTML.
- **Writes**: Server Actions (and a few Route Handlers) call the API and return the result. The
  client updates with `useOptimistic` + `revalidatePath`, so the UI responds instantly.
- **No CORS, no public API surface, no API tokens in the browser.** The API trusts only requests
  carrying a valid session token, and only Next.js has one.

Later, when Stripe webhooks or a public API arrive (Brief §6.2), Traefik routes `/api/*` to the
API container. Nothing else changes.

---

## 3. Repository layout

One repo, a pnpm workspace, two apps and one shared package.

```
paypure/
├─ docker-compose.yml          # dev: the whole system (R2)
├─ docker-compose.prod.yml     # prod: built images + traefik + backups
├─ .env.example                # optional overrides; defaults live in compose
├─ pnpm-workspace.yaml
├─ api/                        # NestJS app        → image paypure-api
│  ├─ Dockerfile               # targets: dev, prod
│  ├─ prisma/                  # schema + migrations
│  └─ src/
├─ client/                     # Next.js app       → image paypure-client
│  ├─ Dockerfile               # targets: dev, prod
│  └─ src/app/
├─ packages/
│  └─ domain/                  # @paypure/domain: pure TS, no I/O
│     ├─ money.ts              # integer minor units, rounding, formatting
│     ├─ currency.ts           # ISO 4217 minor-unit table (07 §1.1)
│     ├─ rates.ts              # task → project → client → workspace resolution (Brief §7.2)
│     ├─ invoice.ts            # line grouping, taxes, discount, totals
│     └─ schemas/              # zod schemas = the API contract
└─ docs/
```

**Why a shared package.** The invoice builder (S9) renders a live preview on the client, and the
API computes the same invoice when it creates the draft. If the two calculations differ, the
preview shows one total and the invoice another. `@paypure/domain` holds the single
implementation of rate resolution, grouping, rounding and tax, and both apps import it. It also
holds the zod schemas, so request and response types are shared, not copied.

---

## 4. Stack at a glance

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Node 24 LTS**, `node:24-alpine` images | Current LTS. Alpine keeps images small (Prisma 7 has no native engine, so Alpine works) |
| Package manager | **pnpm 10** via corepack | Fast, disk-efficient, workspaces. Same as MarketPoster |
| Language | **TypeScript** (strict) everywhere | One language across api, client and domain |
| API | **NestJS 11** on the **Fastify** adapter | Required. Fastify has lower overhead than Express |
| Validation | **zod 4** + `nestjs-zod` | Schemas in `@paypure/domain` validate in the API and type the client |
| ORM | **Prisma 7** (`@prisma/adapter-pg`) | Known from MarketPoster. v7 is TypeScript-only (no Rust engine): smaller and faster to start |
| Database | **PostgreSQL 18** | Required |
| Jobs | **pg-boss** | Job queue and cron on Postgres. No Redis (R3) |
| PDF | **Gotenberg 8** (Chromium) | Renders the same HTML invoice sheet the user sees. Screen, PDF and print are identical (Guide §3, §5.13) |
| Email | **nodemailer** over SMTP · **Mailpit** in dev | Provider-agnostic. Mailpit catches every dev email in a web UI |
| Client | **Next.js 16** (App Router, RSC, Server Actions), **React 19** | Required. `output: 'standalone'` for a small image |
| Styling | **Tailwind CSS 4** on CSS-variable tokens | The design guide is token-based with light and dark themes. Tokens become `@theme` variables |
| UI primitives | **Radix UI** (via shadcn/ui, copied in) + **cmdk** | Accessible dialogs, popovers, menus and the ⌘K palette. We own the component code |
| Icons · font | **lucide-react** · **Inter** via `next/font` | Font self-hosted, no layout shift. `subsets: ['latin', 'cyrillic']`: the print route that Gotenberg renders needs Cyrillic too (Guide §3) |
| i18n | **next-intl** | Labels are i18n keys from day one (Brief D8) |
| Dates | **date-fns 4** + `@date-fns/tz` | Small, tree-shakable, time zone aware |
| Tests | **Vitest** (unit, api e2e) · **Playwright** (hero flows) | One fast runner for all packages |
| Lint/format | **Biome** | One fast binary instead of ESLint + Prettier |
| Logs | **pino** (`nestjs-pino`), JSON to stdout | Docker log rotation, no log agent |
| Proxy (prod) | **Traefik v3** | Docker labels, automatic Let's Encrypt. Same as Stacks |

Exact versions are pinned in lockfiles and image tags when the repo is scaffolded.

---

## 5. API (NestJS)

### 5.1 Shape

- REST, versioned under `/v1`. Resources follow the domain model (Brief §7): `clients`,
  `projects`, `tasks`, `time-entries`, `timer`, `invoices`, `payments`, `members`, `settings`,
  plus `public/invoices/:token` and the internal event stream `events` (06 §4).
- One Nest module per area: `auth`, `workspace`, `clients`, `projects`, `time`, `invoices`, `events`,
  `mail`, `pdf`, `jobs`. Controllers stay thin. Services own the rules in Brief §7.1.
- OpenAPI is generated from the zod schemas and served at `/docs` in dev only.
- **Fastify, not Express.** Faster and lighter. We use no Express-only middleware.

### 5.2 Data rules in Postgres

The brief's money rules are enforced by the database where possible, not only in code:

| Rule (Brief) | How it's enforced |
|---|---|
| Money is never a float | All amounts are **integer minor units** (`integer`, not `bigint`: Prisma returns `bigint` as JS `BigInt`, which breaks JSON) plus an ISO currency code. SQL sums are cast `::int`. Rates are minor units per hour, percentages basis points. On the wire money is `{ minor, currency }`. Rounding happens in one place (`@paypure/domain/money`, 07 §6) |
| Durations | Integer **seconds**. Timestamps are `timestamptz` (UTC). An entry is made of segments (`time_entry_segments`), and every total reads the cached `duration_seconds` (Σ segments). An entry's `date` is a `date` in **the entry's own** `time_zone`, which drives day grouping and gap rows. Segments can't overlap within an entry: an exclusion constraint, so the first migration enables `btree_gist` (06 §2.2) |
| Parallel timers, one per task | `UNIQUE (member_id, task_id) WHERE state <> 'stopped' AND deleted_at IS NULL` (running and paused both count). The limit of 5 live per member is checked by the service under `pg_advisory_xact_lock`. Plus one open segment per entry (06 §2.2) |
| Billed = claimed | `time_entries.invoice_id` is the claim, set when the draft is created, so time can't be invoiced twice (S9). Which line bills an entry is recorded per version in `invoice_line_entries`. Deleting a draft or voiding releases the claim (08 §3.1) |
| Taken off unbilled (D10) | `time_entries.off_invoice` enum (`billed_elsewhere`, `written_off`) + `off_invoice_ref`. A check makes it and `invoice_id` mutually exclusive. "Unbilled" everywhere is defined once, in [07 §10](07-money-and-billing.md#10-unbilled-as-sql) (hourly tasks only, finished entries only; fixed fees have their own remaining-fee rule) |
| Line maths | `invoice_lines.qty_hundredths` is stored for every line kind (rounded once from summed seconds for time lines), and `amount_minor = round_half_up(qty_hundredths × rate / 100)` is computed in `@paypure/domain` and stored, with a check constraint. The PDF never re-derives qty from seconds (07 §6) |
| Rates resolve late (D1) | Unbilled entries store no rate. "Unbilled per client" is one SQL query with `COALESCE(task.rate, project.rate, client.rate, workspace.rate)`, where the workspace rate is used only if the client's currency is the workspace currency (07 §2.1). The rate is copied onto `invoice_lines` when the draft is created |
| Gapless numbering (D4, D9) | `invoice_sequences (workspace_id, period, next_seq)`, `period` = `''` or the year when it resets yearly. Sending runs `UPDATE … SET next_seq = next_seq + 1 RETURNING` **in the same transaction** as the freeze. A failed send rolls back and leaves no gap. `UNIQUE (workspace_id, number)` and `(workspace_id, number_period, number_seq)` cover imported invoices too. The issue date can't be before the last issued one (08 §6) |
| Sent invoices are frozen | Content lives in `invoice_versions`. Triggers reject any change to a frozen version, its lines, taxes and line–entry links, and any update or delete of stored PDFs and activity. A guard trigger on `time_entries` rejects edits to billed fields of entries on an issued invoice unless a correction is being applied. The app connects as a role that doesn't own the tables, so it can't disable triggers (08 §3.3) |
| Fixed fees, payment accounts | Check constraints tie `tasks.billing_mode` to `fixed_amount_minor`. One default payment account per currency: partial unique index `(workspace_id, currency) WHERE is_default AND archived_at IS NULL` (07 §4, §8) |
| Payment state and Overdue are derived | Only `draft · issued · void` is stored. Paid / partially paid / overpaid come from payments minus refunds against the current version's total; Overdue is `issued`, not fully paid and `due_date` < today **in the workspace time zone**. One `displayStatus()` in `@paypure/domain`, mirrored by an `invoice_summary` view (08 §2.1) |
| Snapshots frozen on send | `from_snapshot`, `to_snapshot` and `payment_account_snapshot` (`jsonb`) on `invoice_versions`. Drafts read them live (08 §3.2) |
| Email outbox, activity | `outbound_emails` holds every email exactly as rendered (only delivery columns update). `invoice_activity` is append-only (08 §7.4) |
| Multi-tenant later | Every table has `workspace_id` from day one. Every query is scoped to it |

Partial indexes, triggers and checks that Prisma's schema can't express go into the migration
via `prisma migrate dev --create-only`, then are edited before applying.

Indexes worth having from the start: `time_entries (workspace_id, member_id, date)`, a partial
index on unbilled entries `WHERE invoice_id IS NULL AND off_invoice IS NULL AND state = 'stopped'`, and `invoices (workspace_id, status,
due_date)`.

**Core columns.** Time entries are in [06 §2.2](06-time-and-timers.md#22-schema), invoices in
[08 §3.1](08-invoice-lifecycle.md#31-model) and payment accounts in
[07 §8.1](07-money-and-billing.md#81-model). The rest, beyond `id`, `workspace_id`,
`created_at` and `updated_at`:

| Table | Columns |
|---|---|
| `workspaces` | `name`, `currency`, `time_zone`, `default_rate_minor` null, `default_terms_days`, `number_format`, `number_reset` (`never`·`yearly`), `default_notes`, `ready_threshold_minor` (workspace currency, default 100000), business profile: `business_name`, `sender_name`, `address` text, `phone`, `tax_id`, `logo_file_id` null, `billing_email` (reply-to) |
| `workspace_default_taxes` | `name`, `rate_bp`, `position` |
| `email_templates` | `kind` (`invoice`·`correction`·`reminder`·`thank_you`), `subject`, `body` (Markdown with `{{variables}}`) |
| `members` | `name`, `email`, `role` (`admin`·`member`), `status` (`invited`·`active`·`deactivated`), `password_hash` null, `time_zone`, `time_format` (`12h`·`24h`), `week_start`, `avatar_file_id` null |
| `clients` | `name`, `contact_name`, `billing_emails` text[], `address` text (free-form), `tax_id`, `currency`, `rate_minor` null, `terms_days` null, `colour` (index 0–9), `notes`, `line_layout` jsonb null (the builder's remembered choice), `ready_threshold_minor` null (client currency; needed when it differs from the workspace's), `default_payment_account_id` null, `archived_at` null |
| `projects` | `client_id`, `name`, `rate_minor` null, `budget_kind` (`hours`·`money`) null, `budget_value` null (seconds or minor units), `status` (`active`·`completed`), `notes` |
| `tasks` | `project_id`, `name`, `billing_mode` (`hourly`·`fixed`·`non_billable`), `rate_minor` null, `fixed_amount_minor` null, `estimate_seconds` null, `done_at` null, `position` |

### 5.3 Auth & sessions

- Email + password (**argon2id**). Invites by emailed token (`/invite/:token`).
- **Opaque session tokens** stored hashed in a `sessions` table (no JWT, so logout and
  deactivating a member take effect immediately).
- Flow: the login Server Action calls `POST /v1/auth/login`. The API returns a token. Next.js
  stores it in an `httpOnly; Secure; SameSite=Lax` cookie on the app domain, and sends it as
  `Authorization: Bearer …` on every API call.
- Roles (D7): an `@Roles('admin')` guard. Responses for Members have money fields removed in
  the API, not just hidden in the UI.
- Login is rate-limited with `@nestjs/throttler` (in memory, which is enough for one API instance).
- **Password reset**: `/reset-password` asks for an email and always answers "If that address
  has an account, we sent a link". The link carries a single-use token (stored hashed, expires in
  1 hour). Using it sets the password and revokes all of that member's sessions. Reset and invite
  emails go through the normal mail pipeline ([08](08-invoice-lifecycle.md)).
- **First workspace and admin.** There is no self-signup in v1. A CLI command creates them:
  `docker compose exec api pnpm cli workspace:create --name … --admin-email …`. It prints a
  one-time invite link. The Paydirt import (05 §4) runs after this, against that workspace.

### 5.4 Background jobs (pg-boss)

pg-boss runs **inside the API process**: one container, no extra worker. If load ever needs it,
the same image starts with `ROLE=worker`.

| Job | Trigger |
|---|---|
| `invoice.render` | Queued **inside** the send transaction (pg-boss `send` with the transaction as `db`). Gotenberg renders the frozen version → stored once with sha256. Skips if the file exists (08 §7.3) |
| `email.deliver` | Queued inside the same transaction. Waits for the PDF, then delivers the already-rendered `outbound_emails` row through `MAIL_TRANSPORT`. Idempotent: an email already `sent` is a no-op. 5 retries, then *Failed · Retry* in the activity. Also carries invites, password resets, reminders and thank-you emails |
| `invoice.overdue-notify` | Daily cron in the workspace time zone: email the owner about newly overdue invoices (F4) |
| `time-entries.purge-deleted` | Daily cron: hard-delete entries soft-deleted more than 24 hours ago, skipping any referenced by a frozen version (06 §2.5) |
| `sessions.cleanup` | Daily cron |

### 5.5 PDF

- The invoice sheet (Guide §5.13) is one React component. The client serves a print route,
  `/print/invoice-versions/:versionId?sig=…`, signed with a short-lived HMAC and reachable only on the internal
  network.
- "Internal only" is enforced twice. Traefik's router for the app domain excludes `/print/*`
  (`!PathPrefix(`/print`)`), and the route itself rejects a missing, invalid or expired
  signature. The signature alone is not treated as enough.
- The API asks Gotenberg to load that URL and return a PDF. A frozen version can't change, so its
  PDF is **generated once, after the send commits, and stored** with its sha256 and the sheet's
  `template_version` (`invoice_files`, `bytea`, ~50–100 KB each). It is never re-rendered, even
  when the template changes. Downloads never touch Chromium. Imported Paydirt invoices serve
  their original PDF (08 §3.2, §9).
- Gotenberg runs with `--chromium-restart-after=50` and a memory limit. Drafts never need a stored PDF
  because the preview is HTML (*Send test to me* renders a watermarked one that isn't stored).

**Rejected:** `@react-pdf/renderer` (no browser, but a second layout that drifts from the screen
version) and Puppeteer inside the API image (+400 MB image, and Chromium memory spikes in the
API process).

### 5.6 Files

Only two kinds of file in v1: the business logo and invoice PDFs. Both are stored in Postgres
(`bytea`), so backups are a single `pg_dump`. No MinIO/S3 until the external phase. A
`StorageService` interface keeps the swap to S3 small.

---

## 6. Client (Next.js)

### 6.1 Rendering

| Screen type | Approach |
|---|---|
| App pages (Home, Time, Clients, Invoices…) | Dynamic SSR with RSC. Data is fetched in parallel in server components and streamed with `<Suspense>`. No `fetch` caching for authenticated data |
| Mutations | Server Actions → API. `useOptimistic` for the timer, entry edits and payments. `revalidatePath` refreshes server data |
| Invoice builder (S9) | Server component loads the unbilled tree once. Selection and options are client state. The preview is computed in the browser with `@paypure/domain` (no round trips) |
| Public invoice `/i/:token` | SSR, no login, mobile-first. "Viewed" is logged by a `sendBeacon` to a route handler after 2 s visible, never by the GET (08 §10) |
| Print route `/print/invoice-versions/:versionId` | Same sheet component plus print CSS, used only by Gotenberg |
| Live sync `/events` | Route handler that streams the API's internal SSE (`GET /v1/events`) to the browser. The API holds one `LISTEN` connection and services call `pg_notify` inside their transactions (06 §4) |

### 6.2 Speed for daily use (Brief §5.3)

- **Timer**: `started_at` comes from the server. The ticking clock is a client component, so
  there is no polling. The timer state (every live timer) is in the root layout so the top-bar pill is on every page.
  Other devices and tabs update through live sync: one tab per browser holds the SSE connection
  and fans events out to the others over `BroadcastChannel` ([06 §4](06-time-and-timers.md#4-live-sync)).
- **Time zones**: the device zone reaches the server in a `tz` cookie, so SSR and the browser
  render the same strings (06 §3.3).
- **⌘K palette**: the layout loads a compact list of active clients, projects and tasks (a few KB
  for a small team) once. `cmdk` filters it locally, so search is instant. Invoice-number lookups
  go to the API.
- **No client data-fetching library** in v1 (no TanStack Query, no SWR): RSC + Server Actions
  cover it with less JavaScript. Revisit if a screen needs live polling.
- The API client lives in `src/server/api.ts` and imports `server-only`, so it can never end up in
  the browser bundle.

### 6.3 Design system in code

- Guide §2–4 tokens → `src/styles/tokens.css` as CSS variables, with a `[data-theme=dark]` block,
  mapped into Tailwind 4 with `@theme`.
- Components from Guide §5 live in `src/components/ui/`, built on Radix primitives (shadcn/ui as
  the starting point, then restyled to the guide).
- Numbers use `font-feature-settings: "tnum"`. Money is formatted with `Intl.NumberFormat`
  through one `formatMoney()` helper in `@paypure/domain`.

---

## 7. Docker

### 7.1 Dev: `docker-compose.yml`

`docker compose up` starts everything. Services and ports:

| Service | Image | Host port | Notes |
|---|---|---|---|
| `postgres` | `postgres:18-alpine` | 5432 | Volume `pgdata` mounted at `/var/lib/postgresql` (the PG 18 layout). Healthcheck `pg_isready` |
| `deps` | `./api` target `dev` | — | One-shot: `pnpm install --frozen-lockfile` into the shared `node_modules` volumes, then exits. It's the **only** service that installs packages |
| `api` | `./api` target `dev` | 4000, 9229 | Source bind-mounted. `prisma migrate deploy` → `nest start --watch`. Waits for `deps` to finish and for a healthy Postgres |
| `client` | `./client` target `dev` | 3000, 9230 | Source bind-mounted. `next dev`. Waits for `deps` to finish |
| `gotenberg` | `gotenberg/gotenberg:8` | — | Internal only |
| `mailpit` | `axllent/mailpit` | 8025 | Optional. Catches email when `MAIL_TRANSPORT=smtp`, to see the HTML rendered. The v1 default is `log` |
| `adminer` | `michalhosna/adminer` | 8081 | Auto-login, as in Flow / Stacks / MarketPoster |

Conventions carried over from the other projects:

- `${VAR:-default}` everywhere, with dummy defaults so the stack boots without a `.env`
  (the Flow lesson: services that crash-loop on a missing key while showing "running").
- `node_modules` in named volumes, not on the host, so host and container binaries never mix.
  Only the one-shot `deps` service writes to them. If `api` and `client` both ran `pnpm install`
  at startup, they would write to the same volume at the same time and corrupt it. After
  changing dependencies, run `docker compose run --rm deps`.
- `TZ: UTC` on every service. `json-file` logging with `max-size: 10m`.
- `depends_on: condition: service_healthy` on Postgres. This fixes the Flow README's "api migrates
  before postgres is up, restart it by hand".
- Work inside containers: `docker compose exec api pnpm test`,
  `docker compose exec api pnpm prisma migrate dev --name <change>`.

Sketch (the real file is written when the repo is scaffolded):

```yaml
x-node-dev: &node-dev
  restart: unless-stopped
  init: true
  environment: &node-env
    TZ: UTC
    NODE_ENV: development
  logging:
    driver: json-file
    options: { max-size: 10m, max-file: "3" }

services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-paypure}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-paypure}
      POSTGRES_DB: ${POSTGRES_DB:-paypure}
      TZ: UTC
    command: >
      postgres -c shared_buffers=128MB -c work_mem=4MB
               -c max_connections=40 -c effective_cache_size=384MB
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-paypure}"]
      interval: 3s
      retries: 20

  deps:   # one-shot: the only service that runs pnpm install
    build: { context: ., dockerfile: api/Dockerfile, target: dev }
    command: pnpm install --frozen-lockfile
    volumes:
      - .:/app
      - node_modules:/app/node_modules
      - api_node_modules:/app/api/node_modules
      - client_node_modules:/app/client/node_modules

  api:
    <<: *node-dev
    build: { context: ., dockerfile: api/Dockerfile, target: dev }
    command: sh -c "pnpm --filter api exec prisma migrate deploy && pnpm --filter api start:dev"
    environment:
      <<: *node-env
      PORT: 4000
      DATABASE_URL: postgresql://paypure:paypure@postgres:5432/paypure
      CLIENT_INTERNAL_URL: http://client:3000
      GOTENBERG_URL: http://gotenberg:3000
      MAIL_TRANSPORT: ${MAIL_TRANSPORT:-log}   # log = full email to pino (08 §7.4)
      SMTP_URL: smtp://mailpit:1025            # used when MAIL_TRANSPORT=smtp
      SESSION_SECRET: ${SESSION_SECRET:-dev-only-session-secret}
    ports: ["4000:4000", "9229:9229"]
    volumes:
      - .:/app
      - node_modules:/app/node_modules
      - api_node_modules:/app/api/node_modules
    depends_on:
      deps: { condition: service_completed_successfully }
      postgres: { condition: service_healthy }

  client:
    <<: *node-dev
    build: { context: ., dockerfile: client/Dockerfile, target: dev }
    command: pnpm --filter client dev
    environment:
      <<: *node-env
      API_URL: http://api:4000
      PUBLIC_URL: ${PUBLIC_URL:-http://localhost:3000}
    ports: ["3000:3000", "9230:9229"]
    volumes:
      - .:/app
      - node_modules:/app/node_modules
      - client_node_modules:/app/client/node_modules
      - client_next:/app/client/.next
    depends_on:
      deps: { condition: service_completed_successfully }
      api: { condition: service_started }

  gotenberg:
    image: gotenberg/gotenberg:8
    command: ["gotenberg", "--chromium-restart-after=50", "--api-timeout=30s"]

  mailpit:
    image: axllent/mailpit
    ports: ["8025:8025"]

  adminer:
    image: michalhosna/adminer
    ports: ["8081:8080"]
    environment:
      ADMINER_DRIVER: pgsql
      ADMINER_SERVER: postgres
      ADMINER_DB: paypure
      ADMINER_USERNAME: paypure
      ADMINER_PASSWORD: paypure
      ADMINER_AUTOLOGIN: 1
      ADMINER_NAME: Paypure DB

volumes: { pgdata: {}, node_modules: {}, api_node_modules: {}, client_node_modules: {}, client_next: {} }
```

### 7.2 Images

Both Dockerfiles are multi-stage on `node:24-alpine` with corepack pnpm.

| Image | `dev` target | `prod` target | Expected size |
|---|---|---|---|
| `paypure-api` | Deps only, source mounted | `pnpm deploy --prod` output + `dist/` + Prisma migrations. Runs `node dist/main.js` as user `node` | ~150 MB |
| `paypure-client` | Deps only, source mounted | Next.js `standalone` output + `static/`. Runs `node server.js` as user `node` | ~120 MB |

- **No PM2.** One process per container. Docker restarts it (`restart: unless-stopped`) and
  `init: true` handles signals. PM2 would add ~40 MB per container and duplicate Docker's job.
- In prod, migrations run as a one-shot `api-migrate` service (same image, `prisma migrate
  deploy`) that `api` depends on with `service_completed_successfully`, so the app itself never
  migrates on boot. In dev the `api` command runs them before `start:dev` for convenience.

### 7.3 Prod: `docker-compose.prod.yml`

Same services with built images (`image: ghcr.io/…/paypure-api:${VERSION}`), plus:

- `traefik` (v3): ports 80/443, Let's Encrypt, routes the domain to `client:3000`. No
  compression or buffering on `/events` (SSE), with a heartbeat below the idle timeout (06 §4.6). **`api` and
  `postgres` publish no ports.**
- `api-migrate`: one-shot, described above.
- `pg-backup`: nightly `pg_dump` with 7 daily + 4 weekly retention to a host volume, copied off
  the box (rsync or S3). This is invoicing data, so backups are not optional.
- No `mailpit`, no `adminer` (use an SSH tunnel to Postgres if needed).
- `deploy.resources.limits.memory` on every service (§9).

Deploy: CI builds and pushes both images. The server runs `docker compose pull` and
`docker compose up -d`. Details depend on hosting (§12).

---

## 8. Config & secrets

- The API validates its environment with a zod schema at boot and fails fast with a readable
  message. Dev defaults live in compose. Prod values live in a `.env` on the server, never in the
  repo.
- Secrets in prod: `SESSION_SECRET`, `PRINT_SIGNING_SECRET`, `POSTGRES_PASSWORD`, SMTP
  credentials (once `MAIL_TRANSPORT=smtp`).
- `MAIL_TRANSPORT` (`log` | `smtp`) is part of the env schema, `log` by default.
- `.env.example` lists every variable with a one-line comment.

---

## 9. Resource budget

Target host: **2 vCPU / 2 GB RAM**. Limits are set in compose. Expected idle use is about half of
each limit.

| Service | Memory limit | Tuning |
|---|---|---|
| postgres | 512 MB | `shared_buffers=128MB`, `work_mem=4MB`, `max_connections=40` |
| api | 256 MB | `NODE_OPTIONS=--max-old-space-size=192`. One extra Postgres connection held for `LISTEN` (06 §4.7). Prisma pool of 10: with `@prisma/adapter-pg` this is `max: 10` on the `pg` Pool, not a `connection_limit` URL parameter. pg-boss uses its own small pool (2) |
| client | 256 MB | `--max-old-space-size=192` |
| gotenberg | 512 MB | Busy only when sending. Chromium restarts every 50 PDFs |
| traefik | 64 MB | — |
| pg-backup | 64 MB | Idle except at night |
| **Total** | **~1.6 GB** | Leaves headroom for the OS and Docker |

Compare: the Stacks dev stack runs Redis, Celery ×2, MinIO, Traefik and more. Paypure is 4
containers in prod (plus Traefik and backups) because Postgres covers queue, sessions and files.

---

## 10. Performance targets

| Measure | Target | How |
|---|---|---|
| App page server render (p95) | < 150 ms | Parallel RSC fetches. Indexed, workspace-scoped queries. No N+1 (Prisma `include`/`select`, or one SQL view for unbilled totals) |
| API read endpoints (p95) | < 50 ms | Fastify, lean queries, JSON only |
| Timer start / stop | Feels instant (< 100 ms visible) | Optimistic UI, server confirms in the background |
| Invoice builder preview update | < 16 ms (one frame) | Pure client-side calculation with `@paypure/domain` |
| JS sent to the browser, app shell | < 150 KB gzipped | Server components by default. `"use client"` only for interactive leaves |
| PDF render (first time) | < 3 s | Gotenberg, then cached forever |
| Cold `docker compose up` (cached images) | < 30 s to usable | Healthchecks, no seed scripts that call external services |

---

## 11. Testing & quality

| Level | Tool | Scope |
|---|---|---|
| Domain | Vitest | `@paypure/domain`: rate resolution, rounding, tax, grouping. Table-driven tests. This is where money bugs are caught |
| API | Vitest + Supertest against a real Postgres (`paypure_test` database in the same container) | Each module's endpoints, transactions and the DB-enforced rules in §5.2 |
| Client | Vitest + Testing Library | Interactive components (timer, builder, palette) |
| End to end | Playwright | Hero flows F2 (track a day) and F3 (month-end invoice), run against the compose stack |
| Forms | Playwright + Biome `a11y/useButtonType` | Real `<form>`s only (Guide §7): each hero-flow form is submitted with Enter, and Cancel never submits |
| Static | Biome, `tsc --noEmit` | Pre-commit and CI |

All commands run in containers: `docker compose exec api pnpm test`.

---

## 12. Decisions taken here (please challenge)

| # | Decision | Alternative we rejected |
|---|---|---|
| T1 | API only on the internal network. The browser talks to Next.js only (BFF) | Public API with CORS and tokens in the browser |
| T2 | Postgres for jobs (pg-boss), sessions and files | Redis + BullMQ, MinIO/S3: three more containers for a small team |
| T3 | Gotenberg for PDFs from the same HTML sheet | react-pdf (second layout), Puppeteer in the API image |
| T4 | Prisma 7 | TypeORM (Flow: heavier, weaker types), Drizzle (lighter, but new to the team) |
| T5 | Fastify adapter | Express (default, slower, no feature we need) |
| T6 | Opaque DB sessions | JWT (can't revoke a deactivated member immediately) |
| T7 | Shared `@paypure/domain` package for money and invoice logic | Duplicated calculation in client and API |
| T8 | Integer minor units for money, seconds for durations | `numeric` / decimals, floats |
| T9 | No PM2. Docker restarts processes | PM2 inside containers (Stacks, MarketPoster) |
| T10 | Vitest + Biome | Jest + ESLint + Prettier (slower, more config). Easy to swap back if preferred |
| T11 | Traefik in prod | Caddy (equally light, but Traefik is already known) |
| T12 | Money and rounding rules live in [07](07-money-and-billing.md) (M1–M12) and in `@paypure/domain` | Rules spread across services |
| T13 | Email outbox: rendered and stored in the send transaction, delivered by a job, `MAIL_TRANSPORT=log` in v1 (08 L7) | Sending inside the request. A real provider from day one |
| T14 | Live sync over SSE: the API `LISTEN`s, Next proxies `/events` (06 TT10, TT11) | Websockets. Next connecting to Postgres |

## 13. Open questions

1. **Hosting.** Which VPS/provider, and where does CI run (GitHub Actions + GHCR)? This decides
   the deploy section and where backups are copied.
2. **Email provider.** Depends on Brief §11 Q4 (own domain vs Paypure address). SES, Postmark or
   the existing mail host over SMTP all work with nodemailer.
3. **Domains.** One domain for the app and public invoice links (`app.example.com/i/…`), or a
   separate short domain for client-facing links?
4. **Error tracking.** Is pino + `docker logs` enough for internal v1, or add Sentry (or
   self-hosted GlitchTip, which costs another container) from the start?
5. **Paydirt migration** (Brief §11 Q5). A one-off script in `api/scripts/`, run with
   `docker compose run --rm api …`. It reads the **CSV exports** in `data/` (git-ignored, mounted
   read-only), with the Paydirt API ([08](../paydirt/08-data-model-and-api.md)) as a fallback for
   anything the exports lack. The plan is in [05 §4](05-paydirt-data.md#4-migration-plan-draft).
   It must be idempotent (keyed on Paydirt ids or row hashes), because we will re-run it when the
   invoice export arrives.
