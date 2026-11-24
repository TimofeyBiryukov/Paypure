# 02 — Paypure design guide

Status: draft v0.3 · 2026-11-23 · Paydirt's design system is in
[../paydirt/02-design-system.md](../paydirt/02-design-system.md)

This guide sets the visual language, components and interaction rules so screens can be designed
consistently. The values are starting points to try out in the first mockups, not final decisions.

---

## 1. Character

| Paydirt was | Paypure is |
|---|---|
| Warm beige canvas, steel-blue band, olive "add" buttons | Quiet off-white canvas, ink text, **one** accent colour |
| Dense desktop chrome (nav bar + blue band + tabs + sidebar + footer) | One slim top bar and one page header. Content takes the rest |
| Status shown three ways (card flag, page overlay image, ribbon) | One **status chip** component everywhere |
| Big money figures with superscript sign | Big money and time figures in **tabular numerals**, which carry the visual weight |
| Desktop only, 1050px minimum | Responsive from 360px. Phone handles the timer and status checks |

**Keywords:** calm, precise, ledger-like, quick. The look of good stationery: plenty of white,
clear rules, numbers that line up.

**Kept from Paydirt:** the client colour badge (identity at a glance), the price pill on tasks,
the big number + small caption summary, the timer's start-in-the-past menu and gap filling,
linkable filters in the URL.

---

## 2. Colour

All colours are tokens. Components never use raw hex. Light and dark themes ship together.

### 2.1 Neutrals & surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F6F3` | `#141413` | App canvas |
| `--surface` | `#FFFFFF` | `#1C1C1A` | Cards, tables, sheets, popovers |
| `--surface-sunken` | `#F0EEEA` | `#0F0F0E` | Wells, empty states, input fill on hover |
| `--border` | `#E4E1DB` | `#2E2D2A` | Hairlines, card borders, table rules |
| `--border-strong` | `#CFCBC3` | `#45433F` | Input borders, dividers that must be seen |
| `--text` | `#1B1A18` | `#EDEBE6` | Body and headings |
| `--text-muted` | `#5F5B54` | `#A39F97` | Secondary text, captions, table headers (≥ 4.5:1 on `--bg` and `--surface`) |
| `--text-faint` | `#8C877E` | `#77736B` | Placeholders, disabled text and zero values only (not for content that must be read) |

### 2.2 Accent

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#2A6478` | `#6FB3C9` | Primary buttons, links, focus ring, selected nav, running timer |
| `--accent-hover` | `#225465` | `#8AC4D6` | |
| `--accent-soft` | `#E3EEF1` | `#1D3138` | Selected rows, active filter chips, info banners |
| `--on-accent` | `#FFFFFF` | `#0D1A1F` | Text on accent fill |

The accent is a deeper and calmer descendant of Paydirt's steel blue `#579db9`, so the brand
lineage carries over. Paydirt used green for "Add". Paypure doesn't: green means **paid** only.

### 2.3 Status (semantic)

Each status has a **fg** (text/icon), **bg** (chip fill) and a **solid** variant (dot, bar).

| Status | fg (light) | bg (light) | Meaning |
|---|---|---|---|
| `neutral` | `#5F5B54` | `#EEECE7` | Draft, inactive, archived |
| `info` | `#1F5E8C` | `#E2EEF8` | Sent, running |
| `warning` | `#8A5A00` | `#FBF0D9` | Partially paid, budget ≥ 80% |
| `danger` | `#B3261E` | `#FBE5E3` | Overdue, budget exceeded, destructive actions |
| `success` | `#2E7D4F` | `#E2F2E8` | Paid, saved |
| `void` | `#8C877E` | `transparent` + 1px `--border-strong` | Void (number struck through) |

Dark-theme values are the same hues at about 70% lightness for fg and about 18% for bg. They are
generated in tokens and must keep ≥ 4.5:1 for fg on bg.

### 2.4 Client colours

There are 10 badge colours, picked so white monograms pass 4.5:1. They are reused as series
colours in the time chart.

`#3E7CB1` `#7A4FC9` `#B8650A` `#1E8C7E` `#C63D3D` `#3F8A2E` `#3A3A3A` `#B83F6A` `#6B3A63` `#C2502A`

A new client gets the next unused colour (not a random one). Users can change it, but only to one
of these 10 colours. A free picker made unreadable badges possible in Paydirt.

---

## 3. Typography

| Role | Family | Notes |
|---|---|---|
| UI | **Inter** (variable), fallback `system-ui, -apple-system, "Segoe UI", sans-serif` | `font-feature-settings: "tnum" 1, "cv11" 1` on every element that shows numbers |
| Documents (invoice sheet, PDF) | Inter as well | Screen, PDF and print look identical. The look comes from layout, not a second font. Ship the **Latin + Cyrillic** subsets: our client names and bank details include Cyrillic ([05 §2](05-paydirt-data.md#2-the-numbers)), and a missing glyph in a PDF is silent |
| Mono (rare) | `ui-monospace, "JetBrains Mono"` | Invoice numbers in tables (optional), keyboard hints |

### 3.1 Scale

Base is 14px / 20px. The scale is modular around 1.2, rounded to whole pixels.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 40 / 44 | 600 | Hero figures: running timer, invoice total on the invoice page |
| `title-1` | 28 / 34 | 600 | Page title |
| `title-2` | 20 / 28 | 600 | Section heading, card title |
| `title-3` | 16 / 24 | 600 | Sub-section, list group heading (e.g. day heading) |
| `body` | 14 / 20 | 400 | Default |
| `body-strong` | 14 / 20 | 600 | Names in rows, emphasised values |
| `figure` | 24 / 28 | 600 tnum | Stat values in summary strips |
| `caption` | 12 / 16 | 500 | Labels above stats, table headers, helper text. **Sentence case, not uppercase** |
| `micro` | 11 / 14 | 600 | Chips, badge monograms, keyboard hints |

Rules:
- Use no more than three sizes per component.
- Figures are always tabular and right-aligned in columns.
- Paydirt's "UNBILLED"-style uppercase grey headings become sentence-case `caption` in
  `--text-muted`, which reads better and passes contrast.

---

## 4. Space, layout, shape

| Token | Value |
|---|---|
| Spacing scale | `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64` |
| Radius | `--r-sm 4px` (chips, badges) · `--r-md 8px` (buttons, inputs) · `--r-lg 12px` (cards, popovers, sheets) · `--r-full` (avatars, timer button) |
| Border | 1px `--border`. Cards use a border, not a shadow |
| Elevation | Only floating layers have a shadow. `--shadow-pop: 0 8px 24px rgb(0 0 0 / .12), 0 1px 2px rgb(0 0 0 / .06)` for menus, popovers, dialogs and toasts |
| Content width | Lists and dashboards max **1200px**. Forms max **640px**. The invoice sheet is **800px** (A4 ratio) |
| Gutters | 16px (< 640) · 24px (640–1024) · 32px (> 1024) |
| Row height | Table/list rows 48px (compact 40px). Touch targets ≥ 44px on mobile |
| Breakpoints | `sm 640` · `md 1024` · `lg 1280` |

### 4.1 App shell

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◆ paypure   Home  Time  Clients  Invoices        [⏵ Acme · Design 1:24:07 ■] ⌘K  (JD) │  ← top bar 56px
├──────────────────────────────────────────────────────────────────────────┤
│  Page title                                         [Secondary] [Primary]│  ← page header
│  optional subtitle / breadcrumb                                           │
│  ─ tabs (optional) ─────────────────────────────────────────────────────  │
│                                                                          │
│  content (max 1200, centred)                                             │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Top bar** (`--surface`, bottom border): wordmark, 4 nav items, the **timer pill** (always
  visible; it shows the running timer or a "Start timer" button), the command palette (⌘K) and an
  avatar menu (Profile, Settings, Sign out).
- **Page header**: title (with a breadcrumb above it on detail pages, e.g. `Clients / Acme Co`),
  actions right-aligned with **one primary** button at most, and optional tabs underneath.
- **No footer** in the app. Help and feedback live in the avatar menu.
- **Mobile (< 640):** the top bar collapses to wordmark + timer pill + avatar, and a **bottom tab
  bar** (Home · Time · Clients · Invoices) holds the nav. The page header actions turn into a
  single primary button plus an overflow menu.
- **Settings** uses the same shell with a left sub-nav inside the content (it becomes a list page
  on mobile). Paydirt had a separate layout for settings.

---

## 5. Components

Every component lists its states. Missing states are a design bug.

### 5.1 Button

| Variant | Use | Look |
|---|---|---|
| `primary` | The one main action of a view | `--accent` fill, `--on-accent` text |
| `secondary` | Other actions | `--surface` fill, `--border-strong` border, `--text` |
| `ghost` | Toolbar and row actions | No fill. Hover `--surface-sunken` |
| `danger` | Void, delete (in a confirm dialog only) | `--status-danger-solid` fill |
| `icon` | Icon-only actions, always with a tooltip and `aria-label` | 32×32 (40×40 on touch) |
| `split` | Primary + ▾ menu (e.g. *New invoice ▾ blank*) | Joined pair |

- Sizes: `sm` 28px · `md` 36px (default) · `lg` 44px (main page action on mobile, Send invoice).
- States: default, hover, active, focus-visible (2px `--accent` ring, offset 2px), disabled
  (with a tooltip that says why, e.g. "Add a billing email to send"), loading (spinner replaces
  the label, width locked).
- Labels are a verb + object in sentence case: "Create invoice", "Record payment".

### 5.2 Inputs

- Text, textarea (auto-grow), select/combobox, date, **duration** and **time**, money, percentage,
  checkbox, radio, switch, segmented control.
- 36px high, `--r-md`, 1px `--border-strong`. Focus shows an accent ring. Error shows a
  `--status-danger` border with a message underneath (not only a red outline, and no shaking
  button as in Paydirt).
- Labels sit **above** the field (Paydirt used a 180px right-aligned label column). Helper text
  sits below in `caption`.
- **Smart inputs show what they parsed.** The time field accepts `9`, `930`, `9:30p`, `now`,
  `+1h30`, and duration accepts `1.5`, `1h30`, `90m`, `1:30`. The normalised value appears as a
  hint ("→ 9:30 PM", "→ 1h 30m") while typing. This fixes the surprising am/pm guesses in
  Paydirt.
- **Money input** shows the currency symbol as a prefix and the code as a faint suffix in
  multi-currency contexts.

### 5.3 Combobox / picker

- Searchable list with keyboard navigation, used for client, project, task and member.
- The **task picker** groups results under `● Client / Project`, matches tokens across all three
  levels (as Paydirt's tracker search did), bolds the matches and puts recent tasks first.
- An inline "Create “{query}”" row at the bottom of the results handles the common "new task
  while tracking" case.

### 5.4 Client badge

- A rounded square (`--r-sm`) with the client colour and a 2-letter white monogram (`micro`).
  Sizes 20 / 24 / 32 / 40. A logo image can replace the monogram.
- Always paired with the client name, except in dense charts where it gets a tooltip.

### 5.5 Status chip

- Pill (`--r-full`), `micro` text, status bg + fg, with a leading 6px dot.
- Labels: `Draft` · `Sent` · `Partially paid` · `Overdue · 12d` · `Paid` · `Void`.
  Overdue includes the number of days. Which chip shows is decided by one function,
  `displayStatus()` ([08 §2.1](08-invoice-lifecycle.md#21-stored-vs-derived)). Paid can carry
  an "overpaid $200" note.
- A corrected invoice shows a small `rev 2` marker after its number.
- The same chip is used on lists, the invoice header, the client page and Home. Status never
  appears as an image or ribbon.

### 5.6 Rate pill

A small outlined pill on task rows that explains billing at a glance:
`€90/h · from client` · `€120/h` (override) · `€1,200 fixed` · `€1,200 fixed · €600 billed` ·
`Non-billable` · `No rate` (warning colour, when nothing resolves; 07 §2.1). Clicking it opens
the task's billing popover.

### 5.7 Money & time display

| Rule | Example |
|---|---|
| Format money in the client's currency and locale | `€1,234.50`, `$980.00` |
| In the app, show the ISO code only when currencies are mixed in view | `€1,234.50 EUR` / `$980.00 USD` stacked |
| On documents (sheet, PDF, email), always show the code on totals. `$` alone is ambiguous for clients abroad. Lines don't repeat it | `Total $2,307.60 USD` |
| Never sum different currencies. Show one row per currency | Home "Ready to invoice: €4,200 · $1,150" |
| Zero shows as `—` in tables and as `0` in stat strips | |
| Durations in the UI are `h:mm` | `1:30`, `37:45` |
| Durations on invoices are decimal hours, 2 dp | `1.50 h` |
| Week totals in time views are hours + minutes | `32h 15m` |
| Dates are relative when recent, absolute otherwise | `Today`, `Yesterday`, `Mon 16 Nov`, `16 Nov 2026` |
| Times follow the locale (24h by default for EU, configurable per user) | `09:30`/`9:30 AM` |
| Times are shown in the device's zone. An entry created in another zone shows that zone's label | `09:30 JST` |

### 5.8 Stat strip

A row of 2–5 stats, each with a `caption` label and a `figure` value. A stat can link to its
filtered list (as Paydirt did). Use it on Home, the client page, the Time page and the Invoices
list. It stacks 2-up on mobile.

### 5.9 Tables & lists

- Header in `caption` `--text-muted` with sortable columns (▲▼). Rows are 48px with a hairline
  between them, and hover shows `--surface-sunken`.
- The whole row is clickable when it opens a record. Row actions sit in a trailing `⋯` menu that
  is always visible (Paydirt showed them on hover only).
- **Bulk selection**: a checkbox column appears on hover or with the `x` key, and a sticky action
  bar appears at the bottom ("3 entries selected · Mark non-billable · Move to task · Delete").
- Group headers (days, projects) are sticky `title-3` rows with a right-aligned total.
- Totals rows go in the footer, one per currency.
- **Mobile**: tables reflow into stacked cards. The primary text, secondary text and right-aligned
  figure are kept, and the other columns are dropped.

### 5.10 Time entry row

```
● Acme Co / Website  ›  Design review                         09:30–11:00   1:30   ⋯
  Went through homepage comps with Jane                          €135 · On INV-2026-0042
```

- Line 1 shows the badge, client / project › task, the outer time range (or "—" for
  duration-only), the **worked** duration (`body-strong`, tnum), a `‖ 2` marker when the entry has
  breaks (tooltip lists them; 06 §2.10) and a menu.
- Line 2 shows the note's first line (with Markdown list markers stripped), a `+8 lines` expander
  when there is more, the value, and the billed state (a link to the invoice), `Billed elsewhere`,
  `Written off`, a `Non-billable` tag, or a `Fixed fee` tag (time covered by the task's fee; 07 §4). Expanded notes render the Markdown subset (§5.13).
  One note in five is a multi-line work log, up to ~1,800 characters in our data.
- Billed rows show a lock icon on hover. Their edit menu offers "Open invoice" and, on a sent
  invoice, "Propose change". A row with a staged edit shows a `Change pending` tag (08 §5).

### 5.11 Gap row

A dashed row between two entries when there is a gap of more than 5 minutes:
`11:00–11:45 · 0:45 not tracked  [+ Fill]`. Fill opens the entry form with the times filled in.
This brings Paydirt's best tracker feature into the main day view. Gaps are computed from
segments. Breaks inside an entry are shown hatched within it and get no Fill, because a pause
was deliberate.

### 5.12 Timer pill (top bar)

| State | Look |
|---|---|
| Idle | `⏵ Start timer` (ghost). Click opens the task picker. `⌥T` toggles it |
| Running | Accent-soft fill, pulsing 6px dot, `Acme · Design review`, `1:24:07` tnum, `■` stop |
| Running, no task | `Choose task…` in the warning colour and the clock |
| Paused | The dot stops pulsing and the time is muted. Shows `⏵` resume and `■` |
| Long-running (> 10h) | Warning colour: `Running 11h · still working?` with a link to edit the start. Never auto-stops |
| Several live | Shows the newest **running** timer (the newest paused one if none run) plus a count chip `+2` before the controls. `⏵`/`■` act on the timer shown. The chip stays on mobile, where the task is hidden. Any long-running timer turns the pill to the warning colour |

Stopping a timer that has no task pauses it and opens the task picker ("Choose a task to log 1:24"),
because a stopped entry always has a task (06 §2.7).

Clicking the pill body opens the **timer popover**: task (changeable), note (autosaves), billable
toggle, *Started at* (editable, with ±5/15/30/60 min nudges and "end of last entry"), and Discard
(with undo). With several live timers it lists them (one row each, with its own clock, pause/resume
and stop) and expands one at a time into those details. `+ Start another timer` sits at the bottom
(S4, 06 §2.4).

### 5.13 Invoice sheet

The document is a white sheet (`--surface`, `--r-lg`, `--shadow-pop` on screen only), 800px
wide, 48px padding. The same component is used for the editor, preview, public page and PDF
(rendered with print CSS).

```
[Logo]                                              INVOICE
Northwind Studio                                    INV-2026-0042
Address · Tax ID                                    Issued 1 Dec 2026 · Due 15 Dec 2026

Bill to                                             Total due
Acme Co · Jane Doe                                  €4,350.50
Address · Tax ID

Summary (optional)
Website and app development, November

Description                                Qty      Rate        Amount
──────────────────────────────────────────────────────────────────────
Website · Design                         12.50 h   €90.00    €1,125.00
  2–28 Nov · 14 entries
Website · Development                    31.00 h   €90.00    €2,790.00
Hosting (Nov)                             1        €40.00       €40.00
──────────────────────────────────────────────────────────────────────
                                              Subtotal      €3,955.00
                                              VAT 10%         €395.50
                                              Total         €4,350.50 EUR

Payment details                                   Notes
Instructions note (e.g. "Leave the reference       free text
field empty")
Beneficiary · address
Bank · address · account/IBAN · SWIFT/BIC
Correspondent bank · account · SWIFT (if set)
─────────────────────────────────────────────────────────────────────
Northwind Studio · INV-2026-0042                          Page 1 of 4
```

**The sheet never shows payment state** (Paid, Balance, Overpaid). A sent version's PDF is
frozen and reused for reminders, so it would go stale after a partial payment. Payments and the
balance live around the sheet: the invoice page's side panel, the public page's *Payments*
block and the email body (08 §7.5).

**From block** carries the business name, then the sender's name, address, phone and email.
**Bill to** carries the client name, contact name and a free-form address (foreign addresses don't
fit structured fields).

**Line layouts** (chosen in the builder, remembered per client):

| Layout | Title | Under the title |
|---|---|---|
| One per task | `Project · Task` | `2–28 Nov · 14 entries` |
| One per task per week | `Project · Task · week of 3 Nov` | `3–7 Nov · 5 entries` |
| **One per entry** (how we invoice today) | `3 Aug 2026 · Project · Task` in `body-strong` | The entry's note, rendered |
| Manual | Free text, which can span several lines | — |
| Fixed fee | `Project · Task` (editable) | `Part of €1,200 fixed fee` when billed in parts |

**Notes on the sheet** render a Markdown subset: `*`/`-` bullet lists, line breaks, and links
(printed as text in the PDF). Everything else prints literally. A note with no list prints as a
paragraph.

**Pagination** (PDF and print). Our invoices regularly run to 4 pages, and the largest had 129
entries:
- A line and its note never split across pages, unless the line alone is taller than a page.
- The table header repeats on every page.
- Totals, payment details and notes stay together. If they don't fit, they move to the next
  page as one block.
- Each page has a footer with the business name, the invoice number and `Page n of N`.
- The first page carries the full header. Later pages start straight with the table.

- Labels are i18n keys from day one, even though v1 ships English only.
- The sheet has no status overlay. The status chip sits in the page header around it.
- A corrected invoice prints `Revision 2 · revised 3 Dec 2026` under the number.
- The only overlay is the *Send test to me* copy: a diagonal `DRAFT · not a valid invoice`
  watermark, with "Draft" in place of the number (08 §7.5).

### 5.14 Feedback

| Pattern | When |
|---|---|
| **Toast** (bottom-centre, 5s, with **Undo** where possible) | After any reversible action: entry deleted, task completed, client archived, timer discarded, payment removed |
| **Confirm dialog** | Only for actions that can't be undone *and* affect money or other people: void invoice, send invoice, delete client with data. The title names the consequence ("Void INV-2026-0042? 14 time entries go back to unbilled.") and the danger button repeats the verb |
| **Inline banner** | Persistent state on a page: "Sent invoices can't be edited. Correct invoice" (opens a revision to review and re-send), "1 change pending · Review and send" |
| **Empty state** | Icon-free well (`--surface-sunken`) with one sentence of explanation and one primary action |
| **Skeletons** | For loading lists and stats. No full-page spinners and no dimming the page to 50% |

**One rule for destructive actions** (Paydirt mixed confirm and no-confirm): reversible actions
get undo, irreversible ones get a confirm dialog.

### 5.15 Other

Tabs (underline style) · Segmented control (Day/Week, Entries/Grouped) · Popover · Menu (icons
optional, destructive items last and in danger colour) · Dialog (max 480px, sheet on mobile) ·
Side panel (420px, for editing an entry or a payment without leaving a list) · Tooltip · Avatar ·
Progress bar (6px, accent; warning ≥ 80%, danger > 100%) · Bar chart (stacked by client colour,
with a legend and hover totals) · Command palette.

---

## 6. Interaction rules

1. **Keyboard first.** `⌘K` opens the palette (navigate, start a timer on a task, new entry, new
   invoice, jump to a client). `⌥T` toggles the timer. `N` creates a new item on list pages. `/`
   focuses search. `E` edits the selected row and `⌫` deletes it (with undo). The palette shows
   these shortcuts.
2. **Edit in place.** Short records (time entry, task, payment) open in a **side panel** on
   desktop and a sheet on mobile. Navigating to a separate page is reserved for records with
   their own life (client, project, invoice).
3. **URL is state.** Filters, periods, tabs and selected records are in the query string, so any
   view can be shared or bookmarked. Paydirt did this well and it's kept.
4. **Autosave vs explicit save.** Small fields save on blur with a subtle "Saved" indicator
   (entry notes, task names, settings rows). Invoice drafts and open corrections autosave too:
   they have no external effect until sent. Other records that affect money (client
   currency/rate, project and task rates, payments) use an explicit **Save**, and the page warns
   about unsaved changes. The pattern
   is the same everywhere it applies. Both kinds are real forms (§7).
5. **Disabled means explained.** Every disabled control has a tooltip that says why and what to
   do.
6. **Optimistic UI** for time actions (start, stop, edit): the UI updates first and rolls back on
   error with a toast.
7. **Live sync.** Timers and entries sync across tabs and devices over server-sent events
   ([06 §4](06-time-and-timers.md#4-live-sync)). A timer started on
   the phone shows up in the desktop top bar within a second, next to the ones already running.

---

## 7. Forms

**Rule: every form in Paypure is a real HTML `<form>`.** There are no pseudo forms: no `<div>`
of inputs committed by an `onClick` on a button, and no `onKeyDown` handler that watches for
Enter to submit. Committing data always goes through the browser's own form submission, so
Enter, validation, autofill, password managers and assistive technology behave the way users
expect. Code review rejects a pseudo form even if it "works".

### 7.1 What must be a form

| Case | Implementation |
|---|---|
| Any set of fields committed together (entry panel, client, task, payment, settings, send dialog, login) | `<form action={serverAction}>` with named inputs and a `<button type="submit">` |
| Inline "add" rows (add task, add tax, add member) | A small `<form>` around the row. Enter submits it |
| **Single-button mutations** (Stop timer, Mark as sent, Archive, Void, Delete draft) | A `<form>` containing one submit button, with any IDs as `<input type="hidden">` |
| Search and filters | `<form role="search" method="get">`. Submitting writes the query string (§6, rule 3). Filtering as you type is allowed on top of this, not instead of it |
| Autosaving fields (entry note, task name, draft invoice) | Still inside a `<form>`. Autosave submits that form (`requestSubmit()`) on blur or debounce, and Enter in a single-line field saves immediately |
| Navigation | A real `<a href>` (Next `<Link>`), never a button with `onClick` that routes |

### 7.2 Enter and keyboard behaviour

These follow the HTML spec. We rely on the browser and don't re-implement them:

1. **Enter in a single-line input submits the form** (implicit submission). This needs a submit
   button in the form. Don't remove it, and if it must be visually hidden, keep it in the DOM.
2. **The default action is the first submit button in DOM order**, and Enter triggers it. The
   primary action must come first in the markup, even if CSS places it elsewhere (for example,
   right-aligned after Cancel).
3. **Every other `<button>` in a form has an explicit `type="button"`** (Cancel, Add line, Show
   more, icon buttons, picker triggers). A `<button>` defaults to `submit`, and a Cancel that
   saves is a classic bug.
4. **Several commit actions are several submit buttons**, distinguished with `name`/`value` or
   `formAction`. For example, *Save draft* vs *Send invoice*.
5. **Enter in a `<textarea>` inserts a new line.** `⌘/Ctrl+Enter` may submit, but only by calling
   `form.requestSubmit()`, which runs validation and the normal submit path. There is never a
   separate save function.
6. **Comboboxes and pickers:** while the listbox is open, Enter selects the highlighted option
   and does not submit (standard ARIA combobox behaviour). This is the only place we
   `preventDefault` on Enter. When the listbox is closed, Enter submits as usual.
7. **Esc** closes a dialog or cancels an inline row. It never submits.
8. The submit button shows a pending state (`useFormStatus`) and ignores repeat submits while it
   runs. Fields are not cleared or disabled before the browser has read the form data.

### 7.3 Fields and validation

- Every input has a `name` and a `<label for>`. Radio groups, segmented controls and checkbox
  groups use `<fieldset>` + `<legend>`. A segmented control is radio inputs styled as segments.
- Custom inputs (time, duration, money, date, task picker) always submit through a real input,
  either the visible one or a `<input type="hidden">` with the normalised value, so the data ends
  up in `FormData`. Parsing happens on submit as well as while typing.
- Use native constraints first (`required`, `type="email"`, `min`, `max`, `step`, `pattern`,
  `inputmode`), and `setCustomValidity` for rules the browser can't express. The server checks
  everything again.
- Errors appear as a message under the field (`aria-describedby`, `aria-invalid`). After a
  failed submit, focus moves to the first invalid field, and a summary appears at the top of
  long forms.
- Use correct `autocomplete` tokens (`name`, `email`, `organization`, `street-address`,
  `current-password`, `new-password`, `one-time-code`) so autofill and password managers work.
- Core forms (login, time entry, client, record payment, settings) **work without JavaScript**
  through Server Actions, with progressive enhancement on top.
- Forms with explicit Save that have unsaved changes warn on navigation and on `beforeunload`
  (§6, rule 4). Autosaving forms don't need to.

### 7.4 Checks

- Biome `a11y/useButtonType` is an error, so every `<button>` declares its type.
- Code review rejects submits through `onClick` and Enter handled through `onKeyDown`.
- Playwright: every form in the hero flows is submitted **with the Enter key** at least once, and
  Cancel buttons are tested to not submit.

---

## 8. Content & voice

- **Plain and short.** "Unbilled", not "billable value not yet invoiced".
- **Sentence case** everywhere, including buttons, titles and labels.
- **Verbs on buttons**, nouns in titles. "Create invoice" (button) on the "New invoice" page.
- **Consequences in confirmations**, not "Are you sure?". For example: "Void INV-0042? 14 entries
  go back to unbilled. The number stays in your sequence."
- **No exclamation marks**, no jokes in errors, no "Oops".
- **Vocabulary is fixed and used everywhere:**

| Use | Never |
|---|---|
| Time entry | block, log entry, time log |
| Task | job |
| Unbilled | not billed, uninvoiced, billable value |
| Billable / Non-billable | not billable, unbillable |
| Send | email, issue |
| Void | cancel, delete (for sent invoices) |
| Correct / correction | edit, amend, revise (for sent invoices) |
| Record payment | add a payment, log payment |
| Member | user, team member, employee |
| Workspace | account (in the UI) |

---

## 9. Accessibility

- WCAG 2.2 AA: text contrast ≥ 4.5:1 (≥ 3:1 for large figures and UI boundaries), both themes.
- Status always pairs colour with text (chip label) or an icon, never colour alone.
- Visible focus on every interactive element. Logical tab order. Dialogs trap focus and Esc
  closes them.
- The timer clock has `aria-live="off"`, with an accessible label read on focus
  ("Timer running, 1 hour 24 minutes, Acme, Design review").
- Respect `prefers-reduced-motion` (no pulsing dot or rolling digits).
- Targets are ≥ 44×44 on touch.

---

## 10. Motion

Motion explains state changes and is never decorative. Durations: 120ms (hover, press), 200ms
(popover, toast, row insert), 280ms (side panel, sheet). Easing `cubic-bezier(.2,.8,.2,1)`. A
time entry added or stopped from the timer slides into its day group. A status change cross-fades
the chip.

---

## 11. Deliverables for the design phase

1. Token file (colour light/dark, type, space, radius, shadow) as CSS variables and a design-tool
   library.
2. Component sheet covering every state in §5.
3. Screens from [03](03-screens-and-flows.md), desktop + mobile, light theme first. Dark theme is
   checked by tokens.
4. A clickable prototype of the two hero flows: **track a day** and **invoice a client at month
   end**.
