# 06 — Time, timers & live sync

Status: draft v0.1 · 2026-11-23 · depends on [01 — Brief](01-brief.md),
[03 — Screens & flows](03-screens-and-flows.md) and [04 — Tech stack](04-tech-stack.md)

How a time entry is stored, how the timer moves between states (including pauses), how time zones
work everywhere in the app, and how a change on one device reaches the others within a second.
This is the reference for the `time_entries` tables, the timer service and the `/events` stream.

---

## 1. Summary

| Topic | Rule |
|---|---|
| Pauses | A timed entry is a list of **segments** (worked intervals). A pause is the space between two segments. Duration = sum of segments, never `end − start` |
| Timer | A time entry in state `running` or `paused`. One live (running **or** paused) entry per member |
| No task | Allowed only while the timer is live. Stopping requires a task |
| Instants | `timestamptz`, UTC, truncated to the second. ISO strings with `Z` over the wire |
| Calendar dates | `date` columns, `YYYY-MM-DD` strings. Never turned into a JS `Date` |
| Member time zone | IANA name on the member profile. Seeded from the device |
| Display time zone | The device's time zone, sent to the server in a `tz` cookie, so SSR and the browser agree |
| Entry date | The local date of the entry's first segment, in the time zone stored **on the entry** |
| Workspace time zone | Drives invoice dates, Overdue, "this month" money figures and daily jobs |
| Live sync | Transactional `pg_notify` → one `LISTEN` connection in the API → internal SSE → Next route handler `/events` → one `EventSource` per browser |

---

## 2. Pauses

### 2.1 Options considered

| Option | How it works | Verdict |
|---|---|---|
| **Split entries** | Pause stops the entry. Resume starts a new one on the same task | Rejected. A day with 4 pauses becomes 5 entries with 5 notes. With *One per entry* invoicing (how we bill today) each fragment prints as its own line |
| **Pause intervals** | Entry has `started_at`, `ended_at` and a child table of `(paused_at, resumed_at)` | Rejected. Duration is `end − start − Σ pauses`, a subtraction that goes wrong when a pause is edited outside the entry's range or two pauses overlap |
| **Segments** ✔ | Entry has a child table of worked intervals `(started_at, ended_at)`. Pauses are what lies between them | Chosen. Duration is a plain sum of positive intervals. Overlap is prevented by a database constraint. A manual start–end entry is just one segment |

### 2.2 Schema

```sql
CREATE TYPE time_entry_state AS ENUM ('running', 'paused', 'stopped');

time_entries
  id               uuid PK
  workspace_id     uuid NOT NULL
  member_id        uuid NOT NULL
  task_id          uuid NULL            -- NULL only while live (check below)
  state            time_entry_state NOT NULL DEFAULT 'stopped'
  time_zone        text NOT NULL        -- IANA, captured when the entry is created (§3.4)
  date             date NOT NULL        -- local date of the first segment in time_zone
  started_at       timestamptz NULL     -- = min(segment.started_at); NULL for duration-only
  ended_at         timestamptz NULL     -- = max(segment.ended_at);   NULL while live or duration-only
  duration_seconds integer NOT NULL DEFAULT 0  -- Σ closed segments (cached, see invariants)
  note             text NOT NULL DEFAULT ''
  billable         boolean NOT NULL
  invoice_id       uuid NULL            -- the billing claim (08 §3.1)
  off_invoice      off_invoice_kind NULL  -- ENUM ('billed_elsewhere', 'written_off')
  off_invoice_ref  text NULL            -- e.g. "Paydirt #142" (billed elsewhere)
  off_invoice_note text NULL            -- optional note when taking it off (S2)
  version          integer NOT NULL DEFAULT 1  -- +1 on every write, used for conflicts (§2.8)
  deleted_at       timestamptz NULL     -- soft delete for undo (§2.5)
  created_at, updated_at  timestamptz NOT NULL  -- on every table, not repeated below

time_entry_segments
  id               uuid PK
  workspace_id     uuid NOT NULL
  time_entry_id    uuid NOT NULL REFERENCES time_entries ON DELETE CASCADE
  started_at       timestamptz NOT NULL
  ended_at         timestamptz NULL     -- NULL = the open (running) segment
```

Constraints (in the migration, edited after `prisma migrate dev --create-only`):

```sql
-- One live timer per member (running or paused)
CREATE UNIQUE INDEX one_live_timer ON time_entries (member_id)
  WHERE state <> 'stopped' AND deleted_at IS NULL;

-- A stopped entry has a task. Only stopped entries can be billed or taken off unbilled
ALTER TABLE time_entries ADD CHECK (state <> 'stopped' OR task_id IS NOT NULL);
ALTER TABLE time_entries ADD CHECK (state = 'stopped' OR (invoice_id IS NULL AND off_invoice IS NULL));

-- At most one open segment per entry
CREATE UNIQUE INDEX one_open_segment ON time_entry_segments (time_entry_id)
  WHERE ended_at IS NULL;

-- Segments are positive and never overlap within an entry (needs btree_gist)
ALTER TABLE time_entry_segments ADD CHECK (ended_at IS NULL OR ended_at > started_at);
ALTER TABLE time_entry_segments ADD EXCLUDE USING gist (
  time_entry_id WITH =,
  tstzrange(started_at, coalesce(ended_at, 'infinity')) WITH &&
);
```

### 2.3 Invariants

The service keeps these. A deferred constraint trigger on `time_entry_segments` checks the first
three at commit and rejects the transaction otherwise.

1. `state = 'running'` ⇔ the entry has exactly one open segment.
2. `state = 'stopped'` and timed ⇒ every segment is closed, `started_at`/`ended_at` equal the
   segment min/max, and `duration_seconds = Σ (ended_at − started_at)` in whole seconds.
3. Duration-only entries have **no segments**, `started_at`/`ended_at` are NULL, and
   `duration_seconds` is what the user typed. They can't be live.
4. Segment bounds are truncated to the second on write (`date_trunc('second', …)`), so sums are
   exact integers and the UI never shows a second the database doesn't have.
5. **Every total in the app reads `duration_seconds`.** Day totals, unbilled hours, budgets and
   invoice quantities never compute `ended_at − started_at`. A pause therefore can't leak into
   billable time.

### 2.4 Timer state machine

```
             start                pause                 stop
   (none) ─────────▶ running ◀──────────▶ paused ─────────────▶ stopped
                        │       resume       │
                        └──────── stop ──────┴──── discard ──▶ (soft-deleted)
```

| Action | From | Effect (one transaction, server time `now()` unless stated) |
|---|---|---|
| **Start** | — | Stops the member's live entry first (row below). Inserts the entry (`state = running`, `time_zone`, `date`) and one open segment from `now()`, or from `now() − offset` for *Start N min ago*, or from the end of the last entry |
| **Pause** | running | Closes the open segment at `now()`. `state = paused`. Adds the segment to `duration_seconds` |
| **Resume** | paused | Inserts an open segment from `now()`. `state = running`. If the local date changed since the last segment ended, see §2.6 |
| **Stop** | running / paused | Running: closes the open segment at `now()`. Paused: nothing to close, the entry ends where the last segment ended (paused time is never counted). Sets `started_at`, `ended_at`, `duration_seconds`, `state = stopped`. Needs a task (§2.7) |
| **Discard** | running / paused | Sets `deleted_at`. Undo clears it |
| **Start another** | running / paused | Stops the live entry as above, then starts the new one, in one transaction. The undo toast restores the old entry to its previous state and discards the new one |

Paused timers count as live. Starting another timer stops a paused one, the same as a running one,
so a member never has two half-finished timers.

**Very short entries.** Stopping an entry under 60 seconds still saves it, and the toast says
"Logged 0:00:42 · Undo". Nothing is dropped silently.

**Long timers.** A timer running for more than 10 hours shows a warning in the pill
("Running 11h · still working?") and a link to edit the start. Paypure never stops or trims a
timer on its own (Brief principle 4).

### 2.5 Delete and undo

Undo for entries (delete, discard, auto-stop) is a soft delete: `deleted_at` is set, and the undo
action clears it. A daily job purges rows deleted more than 24 hours ago, except entries referenced by any
`invoice_line_entries` row (a frozen version still points at them): those stay soft-deleted for
ever. Every query filters
`deleted_at IS NULL`. Restoring a discarded timer fails with a toast if the member has started
another one since, because of the `one_live_timer` index.

### 2.6 Midnight, overnight and travel

- **Running across midnight**: still one entry. It belongs to its start date and shows `+1` on
  the end (Brief §7.1).
- **Paused across midnight** (paused 18:10, resumed at 09:00 the next day): Resume doesn't add a
  segment to yesterday's entry. It **stops** yesterday's entry where it was paused and **starts a
  new entry** on the same task, with the same billable flag and an empty note. The toast says
  "Started a new entry for today. Yesterday's entry kept at 6:40". "Changed local date" uses the
  entry's `time_zone`.
- This keeps the rule that an entry belongs to its start date meaningful, and stops a forgotten
  paused timer from moving a day's work onto another day.

### 2.7 Timer with no task

- `task_id` may be NULL while the entry is `running` or `paused`. The check in §2.2 forbids NULL
  once it is stopped.
- The pill shows `Choose task…` in the warning colour (Guide §5.12).
- **Anything that would auto-stop a task-less timer** (Start another, Resume on a new day) is
  refused with `needs_task`, and the popover asks first: "Choose a task for the running timer
  (1:24) · or Discard". The new timer starts after that, in the same interaction.
- `billable` is stored as `true` while there's no task and is re-derived from the task's mode
  (07 §3) when a task is first set.
- **Stop with no task**: the server pauses the timer, so no time accrues while choosing, and
  returns `needs_task`. The popover opens the task picker ("Choose a task to log 1:24"). Picking a
  task completes the stop. Closing the picker leaves the timer paused, not lost.

### 2.8 Concurrency (two devices, two tabs)

- Timer transitions are **guarded updates**, so a repeated or late action is a no-op, not an
  error:

  ```sql
  UPDATE time_entries SET state = 'paused', version = version + 1
  WHERE id = $1 AND state = 'running' AND deleted_at IS NULL
  RETURNING *;
  ```

  If no row is returned, the service reads the entry and returns its **current** state with
  `applied: false`. The client then shows the real state ("Already stopped on another device").
- Every timer action names the entry (`entry_id`), not "the member's timer". A stale tab that
  pauses an entry which has since stopped can't touch the new timer.
- **Start** relies on `one_live_timer`. Two starts at once: the first commits, the second retries
  once (it now sees a live entry and auto-stops it) and then succeeds.
- **Panel edits** (times, note, task) send the `version` they were loaded with. A mismatch returns
  `409`, and the panel shows "Changed on another device · Reload" and keeps what the user typed.
- Transition times come from the **server clock** only. *Start N min ago* sends an offset, not a
  time. Only explicit edits ("Started at 09:12") send a wall time.

Example: the phone pauses at 12:00:00.4 and the desktop stops at 12:00:00.6. Pause commits
(running → paused). Stop sees `paused`, closes nothing and ends the entry at 12:00:00. Both devices
end with the same entry. In the reverse order, stop commits and the pause returns
`applied: false, state: stopped`.

### 2.9 Editing entries with pauses

| Where | Shows | Edits |
|---|---|---|
| Timer popover (live) | "Started 09:12 · edit", worked time, "2 breaks · 0:25" | The first segment's start (±nudges). Breaks open the segment list below |
| Entry panel S3, Start–end mode | Start, End, **Worked 3:10** (read-only), "2 breaks · 0:45 ▸" | Start moves the first segment's start and End moves the last segment's end. Expanding breaks lists each segment as a start–end row: edit it, remove a break (merges the two segments) or add a break (splits one) |
| Entry panel S3, Duration mode | Duration | Switching a segmented entry to Duration drops the segments after an inline note ("Breaks will be removed. 3:10 is kept"). Switching back creates one segment ending now or at the context time |

Validation (on submit and while typing): segments in order, each end after its start, no overlap,
Start before End. Parsed values are echoed as usual (Guide §5.2). Billed entries are locked,
segments included: on an issued invoice a segment edit is a billed-field change and is staged
as a correction ([08 §5](08-invoice-lifecycle.md#5-changes-to-billed-time-and-other-sources)).

### 2.10 Display

- **Time row** (Guide §5.10): `09:12–13:40 · 3:10` shows the outer range and the **worked**
  duration. A small `‖ 2` marker means the entry has breaks, and the tooltip lists them.
- **Day view**: the entry spans its outer range with its breaks hatched inside it. Breaks are
  shown as part of the entry, muted, **without** `+ Fill`, because a pause was deliberate.
- **Gap rows** are computed from **segments**, not from start/end. A gap is any interval of more
  than 5 minutes on the member's day that no segment covers and that isn't a break inside an
  entry (breaks were deliberate). Overlaps
  between entries are allowed and shown with a small warning, never blocked.
- **Invoices** use `duration_seconds` only. Break times never print. A per-entry line prints the
  date (Guide §5.13), not the range.
- The builder (S9) lists **stopped** entries only. If the client has a live timer, it shows
  "A timer is running on Acme (1:24). Stop it to include that time."

### 2.11 API

`POST /v1/timer/start {task_id?, start: {offset_s} | {after_last_entry: true} | {at}, note?, billable?}`
· `POST /v1/timer/{entry_id}/pause|resume|stop|discard` · `PATCH /v1/time-entries/{id}` with
`version` and either `segments[]` or `duration_seconds`. Each returns the **timer snapshot**:
`{entry_id, state, task, segments[], worked_seconds_closed, version, applied}`. The client clock
renders `worked_seconds_closed + (now − open_segment.started_at)`.

In the client each action is a real `<form>` with a hidden `entry_id` (Guide §7.1, single-button
mutations).

---

## 3. Time zones

### 3.1 Three kinds of value

| Kind | Examples | Storage | On the wire | In JS |
|---|---|---|---|---|
| **Instant** | segment bounds, `sent_at`, `created_at`, activity | `timestamptz` (UTC) | `2026-11-23T08:12:05Z` | `TZDate` with an explicit zone |
| **Calendar date** | entry `date`, `issue_date`, `due_date`, payment date | `date` | `2026-11-23` | The string, or `{y, m, d}`. **Never** `new Date('2026-11-23')` (UTC midnight, wrong day in the Americas) |
| **Duration** | `duration_seconds`, terms in days | integer | integer | number |

`@paypure/domain/time` owns every conversion: `toLocalDate(instant, tz)`,
`fromWallTime(date, 'HH:mm', tz)`, `formatInstant(instant, tz, fmt)` and the calendar-date helpers.
Nothing else calls `toLocaleString()` or the `Date` getters without a zone. Code review rejects
any formatting without an explicit `tz`.

### 3.2 Which time zone, for what

| Zone | Where it lives | Used for |
|---|---|---|
| **Display zone** | The browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`, copied into a `tz` cookie | Showing instants, "today", default dates for new entries, week boundaries in Time views |
| **Member zone** | `members.time_zone` (IANA, NOT NULL) | Server work with no device: emails to that member, notifications. Also the fallback before a `tz` cookie exists |
| **Entry zone** | `time_entries.time_zone`, captured at creation from the display zone | The entry's `date`, its wall times, midnight and resume-the-next-day rules (§2.6) |
| **Workspace zone** | `workspaces.time_zone`, set in Settings · Invoicing (defaults to the first admin's zone) | Invoice issue/due dates and "today" for invoicing, Overdue, Home's "Paid this month", pg-boss cron schedules (`tz` option) |

Overdue is `due_date < (now() AT TIME ZONE workspace.time_zone)::date`. The public invoice page
shows calendar dates only, so it needs no zone.

### 3.3 Server rendering without a hydration mismatch

The server can't know the device's zone, so the device tells it:

1. A tiny inline script in the root layout reads the device zone and writes the `tz` cookie
   (one year, `SameSite=Lax`). If the cookie was missing or different, it calls
   `location.reload()` once (an inline script has no access to the App Router).
2. Server components read `(await cookies()).get('tz')` (`cookies()` is async in Next 15+), validate it against
   `Intl.supportedValuesOf('timeZone')`, and fall back to the member zone.
3. The root layout passes the resolved zone and the member's 12/24h format into a
   `<TimeContext>`. Client components format **only** through it, so the server and the browser
   produce the same strings.
4. The ticking timer shows elapsed time, which has no zone, so it can't mismatch.

The first-ever request renders in the member zone, which is normally right. A traveller sees one
refresh.

### 3.4 Member zone: seeding and travel

- **Seeding.** The accept-invite and login forms include `<input type="hidden" name="tz">` filled
  from the device. The first login stores it as `members.time_zone`. The workspace zone is seeded
  the same way when the workspace is created.
- **When the device and profile differ** (travel, or a new laptop), the app shows a dismissible
  banner: "Your device is on Lisbon time (UTC+0). Your profile says Berlin.
  [Use Lisbon] [Keep Berlin]". The choice is remembered per device zone in `localStorage`. The
  display already follows the device either way. The banner only decides the member zone for
  emails and notifications.
- **Nothing is re-dated.** Each entry keeps its own `time_zone`. Entries shown in another zone than
  the display zone print their times in **their own** zone with a short label
  (`09:00–12:30 JST`), so a day logged in Tokyo still reads as that day. This also applies when
  an Admin looks at a Member in another zone.
- Profile (S16) gets a **Time zone** field (searchable IANA list, showing the current offset).

### 3.5 DST and wall-time input

- Durations are differences between instants, so a timer running through a clock change is
  correct with no special case. Day totals simply add up to whatever the day held (23h or 25h
  days are fine).
- The smart time input converts wall time with `fromWallTime(date, time, entry.time_zone)`:
  - **Time that doesn't exist** (02:30 on the spring-forward night): rejected with the hint
    "02:30 doesn't exist on 29 Mar (clocks go forward) → 03:30?".
  - **Ambiguous time** (02:30 on the fall-back night): takes the **first** occurrence. The hint
    shows the offset ("→ 02:30 UTC+2") with a link to switch to the second one.
  - **End before start** means the next day (`+1`), and the next day is computed in calendar
    terms (`addDays` on `TZDate`), not by adding 24 hours.
- Day view on a DST day: the proportional timeline is 23 or 25 hours long. Mockups only need to
  check that it doesn't break.

### 3.6 Duration-only entries

They have a `date` and a duration, no instants, and their zone only records where they were
created. They sit under "No time of day", take part in day totals, and never create or close a
gap.

### 3.7 "Today" and "this week"

| Context | Today is… |
|---|---|
| Time views, Home "Today" / "This week", new entry default date | Today in the **display** zone. Week start from the member profile |
| Issue date of a draft or a send, due date, Overdue, "Paid this month", Invoices period filters | Today in the **workspace** zone |
| Emails and notifications to a member | The member zone |

---

## 4. Live sync

### 4.1 Where `LISTEN` lives

| Option | Verdict |
|---|---|
| Next.js connects to Postgres and `LISTEN`s itself | Rejected. Next gets database credentials and a second code path that bypasses the API's permission checks (R4, R5) |
| **API `LISTEN`s, exposes an internal SSE stream, Next proxies it** ✔ | Chosen. The API already knows sessions, roles and workspaces, so it filters events per recipient. Next stays a thin pipe and keeps no database access |
| Next holds one upstream stream for all users and fans out | Rejected for v1. Next would have to re-implement per-recipient filtering. Revisit only if connection counts become a problem |

### 4.2 Pipeline

```
Service transaction ── SELECT pg_notify('paypure_events', json) ──▶ COMMIT
                                                                   │ (delivered only after commit)
API: one dedicated pg client  LISTEN paypure_events  ◀─────────────┘
  └─ EventHub: filter per open stream (workspace, member, role) ─▶ GET /v1/events (SSE, internal)
                                                                   │ Bearer session token
Next route handler GET /events (same origin, session cookie) ◀─────┘ pipes the stream
                                                                   │
Browser: one EventSource per browser (leader tab), BroadcastChannel to the other tabs
```

- **Service-level `pg_notify`, not triggers.** It is called through one `events.emit(tx, event)`
  helper inside the mutation's transaction. `NOTIFY` is transactional, so a rolled-back change
  emits nothing and listeners never see uncommitted state. Triggers were rejected: they also fire
  for the Paydirt import and bulk jobs, and building payloads in PL/pgSQL is awkward. An API test
  asserts that each mutating endpoint emits its event.
- **The `LISTEN` connection** is a dedicated `pg.Client` outside the Prisma and pg-boss pools (one
  extra connection out of 40). On error it reconnects with backoff and then sends `resync` to
  every open stream, because notifications sent while it was down are lost.

### 4.3 Event shape

Events are small **invalidations**, not data. The only exception is the timer snapshot, which is
tiny and needed for the 1-second target.

```json
{ "id": "k3x9-1042", "ws": "…", "member": "…", "topic": "timer", "action": "started",
  "entity": "<entry id>", "v": 7, "timer": { "...timer snapshot, §2.11, no money..." } }
```

| Topic | Emitted on | Delivered to | Client effect |
|---|---|---|---|
| `timer` | start, pause, resume, stop, discard, task/start edits | The member's own sessions | Replace the timer store from the snapshot. Pill and popover update with no fetch |
| `time` | entry create/edit/delete/restore, bulk actions, take off unbilled | The member + Admins | Refresh if on Time, Home, a project's Time tab or the builder |
| `catalog` | client/project/task create, edit, archive | Everyone in the workspace | Refresh the ⌘K list. Refresh the current page if it shows that entity |
| `invoice` | draft change, send, payment, void, viewed | Admins | Refresh Invoices, the invoice page, Home, the client page |
| `session` | logout, member deactivated | That session | The API closes the stream. The client goes to `/login` |

Money is never in a payload, and Members never receive `invoice` events.

### 4.4 Applying events in the browser

- **Leader tab.** Tabs elect one leader with the Web Locks API
  (`navigator.locks.request('paypure-sse')`). Only the leader opens `EventSource('/events')` and
  re-posts each event on a `BroadcastChannel('paypure')`. This keeps one connection per browser
  (HTTP/1.1 allows only 6 per origin in dev) and gives the other tabs the same events. Local
  optimistic changes are also posted on the channel, so other tabs update before the server
  answers.
- **Dedup by version.** A tab ignores an event whose `v` is not newer than what it already has,
  which covers the tab that caused the change.
- **Refresh, debounced.** Non-timer events map to route patterns. If the current route matches,
  the client calls `router.refresh()` after 300 ms of quiet. Client state and typed input survive
  a refresh. A side panel whose record changed underneath shows the "Changed on another device"
  banner (§2.8) instead of overwriting the form.
- **Hidden tabs.** After 5 minutes hidden, the leader closes the stream (it saves phone battery
  and connections). On `visibilitychange` back to visible it reconnects and does one
  `router.refresh()`.

### 4.5 Reconnect and missed events

- Each SSE message carries `id: <boot-epoch>-<counter>`. The API keeps a ring buffer of the last
  1,000 events in memory.
- On reconnect, `EventSource` sends `Last-Event-ID`. If that id is in the buffer for the same
  boot epoch, the API replays what came after it. Otherwise it sends `event: resync`, and the
  client does `router.refresh()` and refetches the timer snapshot. No events table is needed: a
  resync is always correct, just slightly slower.
- `retry: 3000` is sent at the start of the stream.

### 4.6 Transport details

- **Route handler** `client/src/app/events/route.ts`: `runtime = 'nodejs'`,
  `dynamic = 'force-dynamic'`. It reads the session cookie, `fetch`es `API_URL/v1/events` with the
  Bearer token and returns the upstream body as a `ReadableStream`. On `request.signal` abort it
  aborts the upstream fetch.
- **Headers**: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`,
  `X-Accel-Buffering: no`. Traefik's compress middleware must exclude `text/event-stream` (it
  does by default; don't override it).
- **Traefik timeouts**: check the entrypoint's `respondingTimeouts` (Traefik v3 sets a default
  `readTimeout`) so a long-lived stream isn't cut. The first deploy includes a smoke test that
  holds `/events` open for more than 2 minutes through Traefik.
- **Heartbeat**: the API writes a `: ping` comment every 25 s, which keeps proxies and phones from
  closing an idle stream and lets the API notice dead sockets.
- **Auth**: the API checks the session when the stream opens and closes the stream when that
  session ends (topic `session`). An expired cookie makes the route handler return `401`, and the
  client goes to login.

### 4.7 Capacity

Each open stream is one pending request in Next and one in the API, a few KB each. A team of 10
with 3 devices is 30 streams, which costs nothing in the 256 MB limits. The API caps each member
at 10 streams and closes the oldest beyond that. Latency from commit to browser is tens of
milliseconds on one host, well inside the 1-second target.

---

## 5. Decisions taken here (please challenge)

| # | Decision | Alternative we rejected |
|---|---|---|
| TT1 | Entries are made of segments. Pauses are the space between them | Split entries per pause, or a table of pause intervals |
| TT2 | `duration_seconds` is the only source for totals and invoices | Computing `end − start` where needed |
| TT3 | A paused timer counts as live. Starting another one stops it | Allowing a paused timer beside a running one |
| TT4 | Resuming on a new local day starts a new entry | Keeping one entry that spans days of work |
| TT5 | `task_id` is nullable only while live. Stop asks for a task and pauses meanwhile | Requiring a task to start, or allowing stopped entries without a task |
| TT6 | Guarded, idempotent transitions on server time, plus `version` for edits | Last write wins, or client-supplied timestamps |
| TT7 | Display zone from the device via a `tz` cookie. Member zone for server work. Each entry stores its zone | One profile zone for everything, or the device zone only |
| TT8 | Workspace zone for invoice dates, Overdue and crons | Server UTC, or the zone of whoever is logged in |
| TT9 | Calendar dates stay `date` strings end to end | JS `Date` at midnight |
| TT10 | API `LISTEN`s and serves internal SSE. Next proxies `/events` | Next connected to Postgres, or websockets |
| TT11 | Transactional `pg_notify` from the services | Triggers on tables |
| TT12 | Small invalidation events plus `router.refresh()`. The timer snapshot is the only data in an event | Pushing full records into a client cache |
| TT13 | One stream per browser (Web Locks leader + `BroadcastChannel`) | One `EventSource` per tab |
| TT14 | In-memory replay buffer with `resync` as the fallback | A persistent events table |
| TT15 | Soft delete with a 24-hour purge for entry undo | Recreating deleted entries from client memory |

## 6. Left to implementation

- The exact gap threshold and how gap rows behave on a travel day with entries in two zones.
- Whether overlapping entries of one member should ever be blocked. v1 only warns. The
  exclusion constraint covers segments within one entry, not across entries.
- The route-pattern map for `router.refresh()` and the debounce value.
- The ambiguous-time switch UI in the smart time input.
- Whether a member's "no time logged today" reminder exists (it would use the member zone).
- Ring buffer size and the stream cap per member, tuned after the first week of use.
