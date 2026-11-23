# 02 — Design system

The visual language of Paydirt, extracted from `app.css` (407 KB, minified) and checked against
screenshots 03, 07, 15, 16, 20, 25–31, 39. CSS values are quoted as found; vendor-prefixed
duplicates are omitted.

## Overall character

Paydirt looks like a 2012–2014 "warm flat" web app. A near-black top bar sits over a
steel-blue header band. Below that is a warm beige canvas holding white cards with very soft
shadows (`0 1px 3px rgba(0,0,0,.08)`). Typography is Open Sans throughout. Titles are light (300)
and large. Labels are small, uppercase and grey. Money figures are big, with a raised currency
sign and a grey ISO code. Colour is used sparingly and has fixed jobs: blue means navigation and
primary actions, olive-green means "Add", red means destructive or overdue, and each client gets
its own colour on its monogram badge. Corners are slightly rounded (2–3px) and borders are
hairlines. The UI mixes Bootstrap 2 pieces (button groups, dropdown menus), Blueprint-grid
leftovers and custom components. The result is dense but calm, built for desktop only.

---

## 1. Colour palette

### 1.1 Core surfaces

| Token (suggested) | Hex | Where |
|---|---|---|
| `nav-bg` | `#1a1a1a` | Top nav bar (`#primary_nav`); also base text colour |
| `nav-text` | `#d4d4cd` | Nav link text; hover `#4891af`; selected `#579db9` on `rgba(0,0,0,.25)` + inset black glow |
| `header-blue` | `#579db9` | Page header band `#page-head`, links, ribbons, progress bars, pill-blue, Dropbubble default |
| `header-blue-border` | `#4891af` | Band bottom border, pill-blue border |
| `header-button` | `#387087` | Buttons inside the band (`#page-head a.action`), inactive tabs, selected-tab text; border `#2d5b6e`, hover border `#295263` |
| `header-subtext` | `#d5e7ee` | Paragraph text inside band |
| `page-bg` | `#f5f0ea` | `#main` content background (beige); also selected tab fill and pill-beige |
| `body-bg` | `#f0e9e0` | `body.app` (visible under footer); footer top border `#e2dcd4` |
| `panel` | `#ffffff` | Cards, boxes, job rows, summary row, invoice page |
| `panel-header` | `#fcfaf8` | Settings box title bar, completed task rows |
| `tracker-overlay` | `rgba(0,0,0,.6)` | Tracker sidebar background; footer `#222`; toggle button `#444` (hover `#555`) |
| `tracker-project-head` | `#eee` | Client/project header in tracker, text `#777` |
| `tracker-highlight` | `rgba(255,255,0,.2)` | Running / highlighted task row (pale yellow) |

### 1.2 Text

| Hex | Use |
|---|---|
| `#1a1a1a` | Body text, `.amount` figures |
| `#111` | Base headings (h1–h6 reset) |
| `#415664` | App h1/h2 (18px section headings, e.g. "Tasks", "Client Details"), settings box titles |
| `#444` | Settings labels, tracker task names |
| `#555`, `#666` | Activity text, empty-state text |
| `#888` | Help text `span.field-desc`, invoice card description |
| `#919191` | `.grey` (secondary text, units "hrs logged", currency codes), table header text, `a.grey` |
| `#aaa` | Summary headings (UNBILLED/OWING…), disabled |
| `#a8a39e` | `.component-empty-state` text |
| `#b38d60` | `.box.empty` text (warm brown) |
| `#ac9881` / `#b6a590` | Footer headings / links |

### 1.3 Links & interactive

| Hex | Use |
|---|---|
| `#579db9` | Link default and visited |
| `#41829c` | Link hover/active; settings nav link |
| `#326478` | Settings nav current/hover |
| `#4991ae` | Default `a.action` button fill, inset bottom `#3d7991` |
| `#4E8AC2` + glow `#79e` | Input focus border / shadow |
| `#E48759` | Invalid input border/glow |
| `#0088cc` → `#0077b3` | Bootstrap dropdown-menu item hover gradient (white text) |
| `#980905` (hover `#670603`) | "Show N completed tasks" link (dark red) |

### 1.4 Semantic / status

| Meaning | Hex | Where |
|---|---|---|
| Add / positive action | `#92b856`, inset `#7da144`, hover `#9ec068` | "Add" buttons, "Add a payment", "Add a note", "Add a line item", tracker start-button hover (`#92b856`→`#789a41`), Dropbubble menus in tracker |
| Success green (strong) | `#44aa77`, inset `#388d63`, hover `#4fb984` | `.action.green`; "enabled" label |
| Success modal | `#5DBB55` | `.box.modal.success-message` |
| Danger | `#b02d2d`, inset `#8f2525`, hover `#c43232` | `.action.delete/.destroy` ("Delete Client"), ribbon.red, pill-red, timesheet declined |
| Danger label | `#DA3838` / border `#bc2323` | "disabled" label |
| Plain red text | `#dd3333` | `.red` |
| Cancel link | orange-red (screens) | "Cancel" / "Discard changes" text links |
| Warning (flash) | `rgba(232,82,16,.9)` (`#e85210`) | Error/warning toasts, blocking-error text, `.flash-row.warning` |
| Notice (flash) | `rgba(72,102,28,.9)` | Success toasts |
| Default toast | `rgba(51,51,51,.9)` | Neutral toast |
| Info box | bg `#d5edf8`, text `#205791`, border `#bfe4f4` | `div.info` / settings descriptions |
| Progress warning / over | `orange` / `#c22228` | Estimate progress bar ≥ threshold / complete |

### 1.5 Document status colours (invoice/quote cards & ribbons)

| Status | Card tag colour | Tag fold shadow | Large overlay |
|---|---|---|---|
| Draft | `#dfa404` (amber) | `#bc8a03` | `draft.png` stamp |
| Sent | `#567189` (slate) | `#485f73` | `sent.png` |
| Overdue | `#d4352c` (red) | `#b72d25` | `overdue.png` (red flag "OVERDUE" on invoice, screenshot 15) |
| Paid | green text `#4c6e1d` on "paid stamp" image | — | `paid.png` |
| Accepted (quote) | `#4c6e1d` | `#005c00` | `accepted.png` |
| Declined (quote) | `#d4352c` | `#b72d25` | `declined.png` |
| Ribbon (corner) | `#579db9` default; `.red #b02d2d`; `.grey #aaa` | fold `#39738a` / `#731d1d` / `#848484` | — |

Timesheet status pill: unsubmitted grey outline `rgba(0,0,0,.1)`; submitted blue outline `rgba(87,157,185,.4)`; approved `green` fill; declined `#b02d2d` fill.

### 1.6 Client colours (avatars & charts)

New clients get a random colour from this list (`Client.defaults().color`):

`#66A1D2` `#780CE8` `#E88A10` `#39D0B9` `#FF3331` `#5ED242` `#2F2F2F` `#E2507C` `#5C2751` `#F46036`

Users can change it to any colour via a minicolors picker on the client form. The client colour is reused as:
- monogram badge background (client list, tracker, time entries, invoice cards),
- the stacked-bar fill for that client in the Time graph (`d3.scale.ordinal().range(clients.map(color))`).

### 1.7 Chart colours

| Element | Value |
|---|---|
| Bars | client colour (see above), stacked by day |
| Axis text | `rgba(0,0,0,.5)`, 12px |
| Grid ticks | `rgba(0,0,0,.08)` (minor `.03`), crisp edges; axis domain lines hidden |
| Chart card | white `#graph_row`, 300px tall, radius 3px, shadow `0 1px 3px rgba(0,0,0,.08)` |
| Loading | spinner `#579db9` 40px; chart opacity .5 |

---

## 2. Typography

### 2.1 Families

| Family | Weights loaded | Use |
|---|---|---|
| **Open Sans** (self-hosted woff) | 300, 400, 600, 700 | Everything in the app UI: `"Open Sans","Helvetica Neue","Helvetica","Arial",sans-serif` |
| Helvetica Neue / Arial | — | Form inputs (`input, select, textarea, .faux_input`) |
| Arial, Helvetica | — | Inside the invoice/quote document (`#invoice-page h1–h6`, normal weight) so documents look like print |
| Marydale (300) | — | Handwritten display font for marketing/onboarding only |
| FontAwesome 3.2.1 | — | Icons |

Base: `html{font-size:100.01%}`, `body{font-size:75%; line-height:1.5}` → **12px / 18px** body.

### 2.2 Type scale (as used)

| Role | Size / line | Weight | Colour | Example |
|---|---|---|---|---|
| Page title (band H1) | 32px / 50px | 300 | white, text-shadow `0 -1px rgba(0,0,0,.2)` | "Clients › Acme Co" |
| Band H3 | 20px / 50px | 300 | white | |
| Top nav link | 15px / 47px | 400 | `#d4d4cd` | "Reports" |
| Tab | 15px / 35px | 400 | white / `#387087` | "Tasks & Expenses" |
| Project name | 22px / 30px (`.manage-project`) | 400 | `#111` | "Website Build" |
| Section heading (h1/h2 in app) | 18px | 600 | `#415664`, shadow `0 1px 0 rgba(255,255,255,.5)` | "Tasks", "Expenses", "Time" |
| Settings box title h2 | 20px / 45px | 600 | `#415664` | "Client Details" |
| Settings box title h3 | 15px / 45px | 600 | `#415664` | "Payments", "Taxes" |
| Big number `.amount` / `.duration` | 25px / 25px | 500 | `#1a1a1a` | "12.50", "1,234.00" |
| Currency sign `.currency` | 13px / 16px, `vertical-align:top` (superscript look) | 700 | `#1a1a1a` | "$" |
| Currency code `span.currency_code` | 12px | 400 | `#919191` | "USD" |
| Summary heading | 12px uppercase | bold | `#aaa` (link colour when clickable) | "UNBILLED", "HOURS LOGGED" |
| Task name `h3.job_name` | 14px / 20px | 600 | `#111` (completed `#919191`) | "Development" |
| Job metrics | 12px (body) | value bold, unit grey | | "**12.50** hrs logged" |
| Form label (settings) | 13px / 46px, right-aligned | bold | `#444` | "Business name" |
| Help text `span.field-desc` | 0.9em (~10.8px) | 400 | `#888` | "Who do you address your invoices to?" |
| Input text | 14px | 400 | — | |
| Button | 13px / 30px (`a.action`), 14px in band, 18px `.massive` | 400 | white | "Save Changes" |
| Activity / payments | 12px; date 11px `#999` | 400 | `#555` | "Jul 2, 2026 · Sent reminder to …" |
| Footer heading / links | 15px / 12px | 400 | `#ac9881` / `#b6a590` | |
| Invoice card number | 13px uppercase | 400 | black | "INV 0042" |
| Invoice card tag | 10px / 15px uppercase | 400 | white | "OVERDUE" |
| Tooltip | 12px, max-width 280px | — | white on black, radius 3px | |

---

## 3. Spacing, grid & layout

| Item | Value |
|---|---|
| Container | centred, `min-width:950px; max-width:1200px`; invoice pages fixed 1145px |
| Page gutters | `#middle` padding `30px 50px`; band rows `padding: 15px 50px` (title), `8px 50px` (links/action bar) |
| Grid | 24-column Blueprint names, fluid: `.span-N { float:left; width: N/24 − gutter; margin-right:2% }`, `.last` → no margin. E.g. span-5 = 19.25%, span-8 = 32%, span-24 = 100% |
| Fixed form widths | `.form-N { width: N em }` (form-3 … form-28) |
| Vertical rhythm | `hr` = 1px `rgba(10,10,10,.08)`, margin-bottom 15px; `hr.space` invisible 15px spacer; `hr.microspace` 5px; `hr.both` 15px top+bottom; `hr.fattest` 8px band `rgba(0,0,0,.03)` used between projects |
| Paddings | `.pad.ten` 10px, `.pad.fifteen` 15px; job row 10px 10px 10px 15px |
| Radii | 2px (band buttons, tracker), 3px (cards, buttons, inputs), 4–6px (Bootstrap dropdown 6px, select2 4px), 5px (pills, labels), 50% (avatars, tracker toggle) |
| Shadows | card `0 1px 3px rgba(0,0,0,.08)`; box `0 0 3px rgba(0,0,0,.08)`; invoice page `0 1px 4px rgba(0,0,0,.18)`; empty state inset `0 0 3px rgba(0,0,0,.08)`; modal `0 10px 25px rgba(0,0,0,.5)` |
| Settings form | label column 180px right-aligned (`.wide-label` 300px), field column `margin-left:180px`; rows separated by `hr`; submit row padded to align with fields (`padding-left:180px`) |
| Settings page | left nav 200px; content `margin-left:240px` |
| Tracker | 325px fixed right; z-index 99; header 10px padding on `#222` |
| Z-index | flash 9000, select2 drop 9999, dropdown 1000, tracker 99, header (site) 11 |
| Min widths | `body.app` 1050px, invoice pages 1245px — no responsive breakpoints in the app |

---

## 4. Component catalogue

### 4.1 Buttons

All share the base rule (`span.action, a.action, input[type=submit], .button, a.add, a.destroy`):

```css
border:0; border-radius:3px; padding:1px 14px; line-height:30px;
font: 400 13px "Open Sans"; color:#fff; text-shadow:none;
background:#4991ae; box-shadow:inset 0 -2px 0 #3d7991;   /* 2px "pressed edge" */
/* :hover → background:#579db9 ; :active → padding-top:2px; padding-bottom:0 (sinks 1px) */
```

| Variant | Class | Visual | Example labels |
|---|---|---|---|
| Primary (default) | `a.action`, `input[type=submit]`, `.button` | steel blue `#4991ae` | "Apply filters", "Archive Client", "Save Settings" |
| Massive | `.massive` | full width, 52px line, 18px | "Save Changes", "Send Reminder" (with `icon-envelope`), "Save Schedule" |
| Large | `.large` / `.large-inline` | 38px line, 14px, full width / inline | |
| Fat | `.fat` | 40px line, 15px | |
| Add (green) | `.add` / `.btn-group.add .btn` | `#92b856`, inset `#7da144`, 26px line | "Add", "Add a payment", "Add a note", "Add a line item" |
| Green | `.green` | `#44aa77` | confirmations |
| Danger | `.delete`, `.destroy` | `#b02d2d` | "Delete Client" |
| Skip / grey | `.skip` | grey gradient `#aaa→#888` | tour "Skip" |
| Disabled | `.disabled`, `.no-click`, `[disabled]` | grey gradient `#d1d1d1→#c4c4c4`, text `#666`/`#999`, no hover | "Save" before input |
| Arrow | `.arrow` | right padding 30px + arrow glyph | "Tell it like it is", "Open Project" |
| In header band | `#page-head a.action` | `#387087`, 1px border `#2d5b6e`, radius 2px, 24px line, 14px (12px in `.sml`) | "New Project", "Print", "Get PDF" |
| Text link action | plain `a` with "or" | `or Cancel`, `or Discard changes`, `or Convert invoice to draft` (link colour or orange-red for cancel) | |

**Button groups**
- `.action-group` (in band): adjacent buttons, inner radii 0, outer 2px, right border removed between → a segmented strip, e.g. [🖨 Print | ⬇ Get PDF | $ Payment Page].
- `.btn-set`: icon-only segmented trio for period navigation [‹] [⌂] [›] with tooltips "previous period / current period / next period".
- **Split button with caret**: `.btn-group` = main `a.action` + `a.action.dropdown-toggle` (`icon-caret-down`, 10px side padding) + `ul.dropdown-menu`. Used for "New Project ▾", "New Invoice ▾", green "Add ▾" (Tasks: "Add from Preset Tasks"), "Add a line item ▾".
- **Row caret button**: Bootstrap `.btn.dropdown-toggle` (white/grey gradient, small square, `icon-caret-down`) at the right of a task row, project header, invoice card (`20×20`, `#f2f2f2`, visible on hover only).

### 4.2 Dropdown menus

Bootstrap 2 `ul.dropdown-menu`: white, `border:1px solid rgba(0,0,0,.2)`, radius 6px, shadow `0 5px 10px rgba(0,0,0,.2)`, min-width 160px, padding 5px 0; items `padding:3px 20px; line-height:20px; color:#333` 14px; hover = blue gradient `#08c→#0077b3`, white text; `li.divider` 1px `#e5e5e5` with 9px margins; `.pull-right` aligns to the right edge.

Menus with icons (FontAwesome left of label, screenshots 27/28):

| Menu | Items |
|---|---|
| Project ▾ | ✎ Edit · 📄 Draft an invoice · $ Add hourly rate · ☑ Mark complete · ✥ Move project · ˄ Hide details · — · ⊗ Delete |
| Task ▾ | ✎ Edit · ⊕ Add a time log · ⏱ Start a timer · ☑ Mark complete · — · ⊗ Delete |
| Time entry ▾ | ✎ Edit · ⧉ Duplicate · ⊗ Delete |

Variants: `.header-dropdown` (dark `#1A1A1A`, radius 2px) for nav; **Dropbubble** (React) — a green `#92b856` (or blue `#579db9`) speech-bubble popover with 8px arrow, white text, used in the tracker ("Start in the past", task options) and for transient tracker flash messages.

**Rate-type picker** (screenshot 31): a dropdown whose items are two-line cards — title (e.g. "Client rate ($85 /hr)") plus grey explanation with bold key phrase ("Time logged is billable at **this client's hourly rate**."); selected item is filled `#579db9` with a ✔.

### 4.3 Tabs

`.secondary_navigation a`: 35px tall, `padding:0 15px`, 15px text, radius `3px 3px 0 0`, 3px gap, fill `#387087`/white text; hover `rgba(245,240,234,.63)` with `#387087` text; selected = page beige `#f5f0ea` (merges into the page); optional leading icon (`icon-pencil` on edit tabs, 6px gap); `.disabled` 50% opacity.

### 4.4 Summary stat bar

`.summary-row`: white card, radius 3px, card shadow, split into equal `.span-5` cells, centred. Each cell has a heading (12px bold uppercase; grey `#aaa`, or link-blue when it is a link) and a value below it (`.currency-summary`, 14px, value + small grey ISO code). Used on the client page (UNBILLED · OWING · OVERDUE · QUOTES · INVOICES), the Time page (HOURS LOGGED · BILLABLE HOURS · UNBILLABLE HOURS · BILLABLE VALUE) and the invoices list (PAID · OWING · OVERDUE · TOTAL).

Reports overview uses a different "big number column" pattern. Each column has an 18px heading and an `hr`, then stacked `.amount` (25px), each with a grey caption below ("hours logged last 30 days", "USD owing"). Links at the bottom read "Time Logged | Full Report".

### 4.5 Cards

| Card | Spec |
|---|---|
| Generic `.box` | white, radius 3px, shadow `0 0 3px rgba(0,0,0,.08)` |
| Settings box `.box.settings` | title bar 45px, bg `#fcfaf8`, bottom hairline `rgba(0,0,0,.06)`, h2/h3 `#415664`; optional green "Add …" button floated right in title; body rows label-left; `.submit-row` |
| Task row `.job_container .job-box` | white, stacked list (first row top radius, last bottom radius), padding `10px 10px 10px 15px`; left: name 14px + metrics line (`icon-time` **0.00** hrs logged · **0.00** hrs unbilled · $0 unbilled, zero metrics at 50% opacity); right: price pill + caret; draggable to reorder/move (overlay message "Drag this task to a different position or project."); optional thin progress bar for estimates; completed rows `#fcfaf8`, grey name |
| Price pill `.job-price-pill` | 1px `#e8e8e8` border, radius 3px, 24px line, 12px: "$1,234.00 fixed price" or "Client rate → $85 per hour" (type grey, arrow, amount) |
| Totals card | small white card right-aligned under task list: "Total" label left (18px grey) and two stat cells "12.50 hours worked · $1,234 unbilled" |
| Invoice grid card `div.invoice.grid` (screenshot 01) | 132×166px white "paper" with curled-shadow pseudo-elements; top-left client badge + number (13px uppercase); hover-only caret menu top-right; description box (12px `#888`, 2px top/1px bottom `#eee` rules, 50px); folded status flag tag at y=110 (`OVERDUE`, `DRAFT`, `SENT`…, 10px uppercase white, fold-cut image at right); currency code `#bbb`; total bottom-right big; hover darkens shadow and turns amount black |
| Invoice page `#invoice-page` | 853px white sheet, shadow `0 1px 4px rgba(0,0,0,.18)`, min-height 1000px; state overlay image (draft/sent/overdue/paid/accepted/declined) pinned at top-right edge (150×100); Arial typography |
| Document sidebar | right column of stacked white boxes: massive primary action ("Send Reminder" / "Save Changes") + "or <link>"; "Payment Settings" (PayPal / Stripe checkboxes with logos); "Payments" (green "Add a payment"; Paid / Owing in grey inset boxes with big bold numbers); "Activity" (green "Add a note"; scrollable `nano` list, 335px, entries with date 11px + text 12px + ×); "Taxes" box with ⚙ |
| Ribbon `.ribbon-wrapper` | 100×100 clip; 45° rotated band 120×32px, `#579db9`/red/grey, fold triangles 3px |
| Tracker task card | project header (`#eee`, badge + "Client / Project" `#777`) then white task rows (10px padding, top border `#eee`), right side ⋮ options + ▶ start (30×34, white `#aaa`; hover green gradient; highlighted/running row pale yellow, start button green) |
| Recent-block card (tracker) | title bar `#eee` with absolute badge at 5px, 40px left padding; job line white; times row: duration bold + "9:00am to 11:30am" + caret; gaps rendered as "11:30am to 12:00pm – No time logged ⊕" |

### 4.6 Tables & list rows

`.report table`: cells padding 10px; header 5px top padding, normal weight `#919191`; row divider 1px `#ddd`; last row/total row no border; `tr.report-clickable-row` whole-row click; sortable columns (`data-behaviour="sortable searchable"` + stupidtable; `th` cursor pointer); first header cell can host an inline search bar (`icon-search` input "Search for a client..." with `icon-remove` clear). Totals rows `tr.report-totals` in `tfoot`, one per currency. Empty cells show grey "–". Money cells: value + grey code.

Time entry rows (screenshot 39): grouped under a day heading ("Monday 16 Nov, 2026" + right-aligned grey total pill "7.50 hrs"); each row = avatar+user name | badge + Client › Project › Task, description below (truncated grey) | clock icon + "9:00am - 10:30am" and value | big duration "1:30" + caret menu. Footer link "Log time on this day".

### 4.7 Forms

| Element | Spec |
|---|---|
| Text input / select / textarea | `border:1px solid #dadada; border-radius:3px; padding:.5em; font-size:14px; margin:7px 0; width:100%; box-sizing:border-box`; transition .2s; focus `border-color:#4E8AC2; box-shadow:inset 1px 1px 2px rgba(0,0,0,.1), 0 0 3px #79e`; invalid `border #E48759` + glow |
| In documents | borders `#eee`, hover `#87b0d6`, focus blue glow — fields look like printed text until hovered |
| `.faux_input` | wrapper styled as an input around date pickers / composite inputs |
| Label-left form row | `div.option_label` (180px, right-aligned, 13px bold `#444`, 46px line) + `div.option_field` (+ `span.field-desc` help text below, `#888`), rows split by `hr` (screenshot 08) |
| Inline (dropdown) form | `form.dropdown_inline_form` in the band action bar: h4 title, inline input (border `#69a8c1` on blue), action button, "or" link |
| Inline row form | `form.backbone.inline_form` inside lists (taxes, keywords, preset line items): inputs in grid spans + right-aligned "Cancel or [Save]" |
| Task inline form (screenshot 30) | "Task Name" 16px input · rate-type dropdown button · disabled grey "Save" until valid · "+ Add a time estimate" link · "or cancel" |
| Autogrow textareas | `data-behaviour="autogrow"` |
| Currency inputs | `data-behaviour="currency_input"` with sign |
| Validation | `data-validates-presence`, `data-behaviour="validate-form"`; error spans `span.error_message` (also `.warning` variant e.g. email verification) |
| Radios/checkbox options | `.line_item_option` 15px labels at 46px line |
| Pills (filter chips) | `.pill` 24px line, radius 5px, border `#e8e8e8`, grey text; `.pill-blue` white on `#579db9` with "×" delete; also red/grey/beige variants. Used for active filters "Billable → Yes", "Team member → Jane" |
| Filter popover | white popover "Filter by team member / billable status / billed status" + selects + "Apply filters" button (screenshot 39) |

### 4.8 Date pickers

jQuery UI Datepicker (`ui-datepicker`, 17em wide, glass theme images), attached by `data-behaviour="datepicker"`; shows a calendar icon button (`/static_assets/calendar.png`) inside a `.faux_input` unless `.no-icon`; display format `M d, yy` ("Jan 30, 2026"); `min-date` / `max-date` attributes. Date range controls: Week/Month/Quarter/Year/Custom/All time select + read-only range chip (`.date-range` `rgba(0,0,0,.05)`, 31px, e.g. "16 to 22 Nov, 2026") + grey human label "(this week)" + ‹ ⌂ › buttons.

### 4.9 Select pickers

Select2 3.x everywhere (`data-behaviour="select2"`): restyled to match inputs. Options include `data-select2-hide-search`, `data-placeholder` ("Any client or project", "Any team member", "Any client", "Any currency"), `data-allow-clear`, `data-type` (remote/grouped sources: `clientProject`, `client`, `currency`, `user`). Results can render HTML (client badge + name, grey hints such as "(15 other clients use no prefix)"). A "chosen" stylesheet is also present but unused in captured views.

### 4.10 Progress bars

`.progress`: 5px tall track `rgba(0,0,0,.05)`, radius 2px; grows to 16px on hover (or `.full-height`) and reveals `.progress-percent`; fill `.pbar` `#579db9` with a diagonal-stripe PNG overlay; `.warning` = orange, `.complete` = `#c22228`. Used for task estimates and project budgets.

### 4.11 Badges, labels, avatars

| Component | Spec |
|---|---|
| Client badge `.badge` | 26×26 square, radius 3px, client colour bg, 13px bold monogram (2 chars, e.g. "Ac"), colour `#fefefa`; `.client_logo` variant = logo image as cover background, text hidden; sizes `.mid` 32px/20px, `.big` 40px/22px |
| User avatar `.avatar` | 26px circle image with inset shadow ring; `.small-round` 36px; `.medium` 80px |
| Header status label | `#page-head .label` 16px, radius 5px: enabled `#44aa77` / disabled `#DA3838` |
| `h1.label` / `h3.label` | inline grey labels ("Quote Status") |
| Count/total chip | grey rounded chip with large number + small unit ("7.50 hrs") |
| Timesheet status | `.timesheet-status` 5px 10px, radius 3px (colours in §1.5) |
| Completed metric | `.job-metric.completed` white on `#ccc`, 11px lowercase |

### 4.12 Flash messages & alerts

| Type | Spec |
|---|---|
| Toast `#flash .flash` | Fixed bottom-centre. 34px tall, min-width 100px, radius `2px 2px 0 0`. It slides up from the bottom edge (`.showing` → `bottom:34px`) and hides after 10s. Variants: neutral `rgba(51,51,51,.9)`; notice/success `rgba(72,102,28,.9)` with tick icon; warning/error/trial `rgba(232,82,16,.9)` with warning icon; `deleted` has its own icon. Links inside are white and underlined |
| Flash row | `.flash-row` full-width banner, `#579db9` (warning `#e85210`), 14px centred |
| Blocking error | modal box with ⚠ 25px, orange text, "Okay" |
| Inline info | `div.info` light blue box `#d5edf8` / `#205791`, 15px padding, radius 3px, 1.2em (e.g. "These taxes are automatically applied…") |
| `.success` | `#e6efc2` / `#264409` / border `#c6d880` |
| Document flash | `#document-flash` above invoice/quote |

### 4.13 Modals

fancybox 2 (`.fancybox-skin` white, radius 4px, shadow `0 10px 25px rgba(0,0,0,.5)`), content usually `.box.modal`. Variants: confirm (message + "Yes, …" / "No, don't …" buttons), `.success-message` (green `#5DBB55`, 20px, white), `.loading` (dark translucent + spinning `icon-refresh`), `.centered` (400px), YouTube video modal, server-loaded forms (move project, import preset tasks, compose email, payment-gateway setup, Log Time Worked modal). Close via `.close-modal` / `data-behaviour="close_modal"`.

### 4.14 Empty states

| Pattern | Spec | Example copy |
|---|---|---|
| `.box.empty` | inset well `rgba(0,0,0,.02)` + inset shadow, warm brown text `#b38d60`, 37px top padding, centred | "You haven't added any of your clients to Paydirt yet. Want to add your first client?" / "You haven't created any recurring invoices. Learn how to create a recurring invoice" |
| `.component-empty-state` | same well, text `#a8a39e`, centred | "No expenses logged." · "Add a task to log time for {Project}" |
| List empties | `.empty` `#666` | "Your account doesn't have any default taxes." · "There aren't any taxes on this document" · "No keywords means no notifications!" |
| Report empties | grey inline text | "No current quotes" |
| Tracker empty | white text centred | "There are no tasks for you to track time towards..." |

### 4.15 Misc

- Tooltips: tipsy, black, 5px 8px padding, radius 3px, gravity via `data-tooltip-gravity` (n, ne…).
- Spinners: `icon-refresh icon-spin` / `icon-spin`.
- Scroll areas: nanoScroller (8px pane `rgba(0,0,0,.05)`, slider `.1`).
- Drag & drop: task rows `draggable`, jQuery UI sortable for line items.
- Logo widget on documents: light-blue dashed box "Add your business's logo" with "hide".
- Guiders.js tour bubbles (`.guider`, `.guider_button`) using the button styles.

---

## 5. Icon set

**FontAwesome 3.2.1** (CSS header "Font Awesome 3.2.1"; `icon-*` class names, e.g. `icon-caret-down`).
Icons seen in the UI:

`icon-signout` (log out) · `icon-angle-right` (breadcrumb) · `icon-caret-down` (menus) · `icon-pencil` (edit) · `icon-remove-sign` (delete) · `icon-remove` (clear search) · `icon-search` · `icon-plus-sign` / `icon-plus-sign-alt` (add) · `icon-play` (start timer) · `icon-time` (hours) · `icon-check` / `icon-check-empty` (complete / select) · `icon-copy` (duplicate) · `icon-file-alt` (invoice/CSV) · `icon-print` · `icon-download-alt` (PDF) · `icon-globe` (view online) · `icon-envelope` (send) · `icon-move` (move project) · `icon-angle-up` (hide details) · `icon-cog` (filters/settings) · `icon-chevron-left/right`, `icon-home` (period nav) · `icon-list` (tracker log) · `icon-upload-alt` (undock) · `icon-circle-arrow-right` (hide tracker, massive buttons) · `icon-refresh icon-spin` (loading) · `icon-warning-sign` · `icon-ok` · `icon-question-sign` (help tooltip) · `icon-calendar`-style PNG for datepicker.

Text glyphs are used too: "$" as an icon (`icon-fake-margin`), "×" for delete, "•••" stacked dots for the tracker options button, "→" in rate pills.

---

## 6. Third-party libraries

`app.js` holds only the application code. Vendor code ships separately in `libraries-*.js`, which
was not captured. The libraries below are inferred from API usage and CSS signatures.

| Library | Evidence | Role |
|---|---|---|
| jQuery (+ jquery_ujs) | `$`, `$.ajax`, `data-remote`, `data-confirm` | DOM, AJAX, Rails UJS |
| Backbone.js + Underscore | `Backbone.Router/Model/Collection/history`, `_.` | SPA router, models, collections |
| Backbone.Epoxy | `Backbone.Epoxy`, `data-bind="text:…, toggle:…, classes:{…}"` | Declarative view bindings |
| React 0.13-era (+ addons CSSTransitionGroup) | `React.createClass`, `React.render`, `React.createFactory` | Tracker, timesheets, projects, preset tasks, page head |
| Redux + ReactRedux, Immutable.js | `createStore`, `Paydirt.Store.dispatch`, `Immutable.fromJS` | Client projects/tasks/expenses store (newer ES6 modules) |
| SystemJS (ES6 modules) | `System.import('./es6/app')` | Loads newer module code |
| Bluebird Promise | `Promise.longStackTraces`, `.bind().then().catch(type,…)` | Promises |
| Lodash (as `window.Lodash`) | `Lodash.assign/noop` | Utilities alongside Underscore |
| HAML-coffee templates | `window.HAML.escape`, `Paydirt.Templates[...]` (94 templates) | View templates |
| CoffeeScript | compiled class patterns (`__super__`) | Source language |
| moment.js (old, `moment.lang`) | `moment().lang()`, `.fromNow` | Dates |
| d3.js v3 | `d3.time`, `d3.layout.stack`, `d3.svg.axis` | Time graph (stacked bars) |
| c3.js | `.c3` CSS | Report charts *(unverified usage)* |
| i18n-js | `I18n.t`, `I18n.toCurrency`, `I18n.locale` | Document translations, currency formatting |
| Money.js-style `Money` + `Types` | `new Money(x)`, `Types.Money/Moment/Float` | Money arithmetic & attribute typing |
| marked | `marked(text,{sanitize:true})` | Markdown in descriptions/line items |
| Select2 3.x | `.select2(`, `.select2-*` CSS | Select pickers |
| jQuery UI (Datepicker, Sortable) | `.datepicker(`, `.sortable(`, `ui-*` CSS | Dates, drag reorder |
| fancybox 2 | `$.fancybox`, `.fancybox-*` | Modals |
| tipsy | `.tipsy(` | Tooltips |
| jquery-minicolors | `.minicolors(` | Client colour picker |
| stupidtable | `.stupidtable(` | Sortable tables |
| autogrow | `.autogrow(` | Auto-height textareas |
| nanoScroller | `.nano` CSS | Custom scroll panes |
| Guiders.js | `Paydirt.Guiders`, `.guider` | Onboarding tours |
| Bootstrap 2.x (partial CSS + dropdown JS) | `.btn`, `.btn-group`, `.dropdown-menu`, `data-toggle="dropdown"` | Buttons, dropdowns |
| Blueprint CSS (grid/typography reset) | `.span-N`, `.last`, `hr.space` | Grid (overridden to fluid) |
| Pusher JS | `new Pusher(key,{encrypted,authEndpoint})` | Real-time |
| Google reCAPTCHA | script tag | Forms (sign-up) |
| Google Analytics (ga.js `_gaq`) | `_gaq.push` | Analytics |
| Stripe / PayPal | settings & payment pages | Payments |

---

## 7. Screenshot references

`screenshots/03-reports-overview.jpg` (frame, big numbers), `07-client-show.jpg` (summary bar,
task rows, price pills, split buttons), `15-invoice-show.jpg` (document sheet, OVERDUE flag,
sidebar boxes, green add buttons), `16-invoice-edit.jpg` (document form fields, massive Save),
`01-invoices-list.jpg` (invoice grid cards with tags), `25…29-client-menu-*.png` (dropdown
menus with icons), `30-client-add-task-form.jpg` (inline form), `31-client-task-rate-types.png`
(rich option dropdown), `08-client-edit.jpg` (label-left settings form), `20-settings-*.jpg`
(settings boxes, info band), `39-time-log-filters-and-entry-menu.jpg` (filter popover, pills, graph,
time rows).

---

## 8. Notes for our version

- The palette is small and does its job: beige canvas, steel blue, olive "add" green, brick red. A token set (§1) would carry it across cleanly. Fix contrast where grey sits on beige (`#aaa`, `#b6a590` fall below WCAG AA).
- There are three button systems (custom `.action`, Bootstrap `.btn`, Dropbubble). Merge them into one button component with variants: primary, add, danger, ghost, split, icon-group.
- Fixed min-widths (1050px, or 1245px on invoices) and no breakpoints mean no mobile layout at all. Our version should be responsive, with the tracker as a drawer.
- The client colour badge and the price pill carry identity and pricing at a glance. Keep both.
- Status is shown three ways (card tag, page overlay image, ribbon). Use one status chip component with fixed colours: draft = amber, sent = slate, overdue = red, paid = green, accepted = green, declined = red.
