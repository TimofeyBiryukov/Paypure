# 05 — Invoices, quotes, recurring invoices, payments and the client-facing document

This is the core billing area of Paydirt. It covers:

- the invoice list
- creating invoices (blank, or from logged time and expenses)
- the invoice page in **Manage** and **Edit** mode
- payments, emails and activity
- recurring invoices
- quotes
- the public, print and PDF versions of a document.

Conventions: *(from code)* means the behaviour comes from `app.js` templates, views or models and
was not seen in the UI. *(unverified)* means it is inferred and not confirmed. All names, amounts
and numbers in examples are placeholders.

---

## 0. Concepts at a glance

### Document types *(from code)*

Invoices and quotes share one "document" model (`Paydirt.Models.Document`) and one editor
(`Views.Documents.Edit`). The `type` attribute selects the variant.

| `type` | What it is | Number prefix | Due date | Payments | Footer placeholder |
|---|---|---|---|---|---|
| `ClientInvoice` | Normal invoice for a client | client shortname + `-` (if set) | yes, plus "due N days from issue" helper | yes | "Payment Details" |
| `RecurringInvoice` | Template that generates ClientInvoices on a schedule | shown as `recurring-NNN` | no (set automatically) | no | "Payment Details" |
| `ClientQuote` | Quote for a client | client shortname + `-` (if set) | no | no | "Terms and Conditions" |
| `FreeformInvoice` | Public "Free Invoice Template" tool (marketing site, no client) | `#` | yes (no offset helper) | no | "Payment Details" |
| `FreeformQuote` | Public "Free Quote Template" tool | `#` | no | no | "Terms and Conditions" |

### Invoice status machine *(from code: `Invoice.state()`)*

The status is **derived**, not stored. Inputs are `sent` (bool), `due_at`, `paid_at`, and the
payments compared with the total.

```
paid()    = paid_at present  OR  (payments.length > 0 AND amountOwing <= 0)
overdue() = sent AND due_at(start of day) < today(start of day) AND NOT paid()

state = "recurring"  if type == RecurringInvoice
      | "overdue"    if overdue()
      | "draft"      if NOT sent
      | "sent"       if sent AND NOT paid()
      | "paid"       if sent AND paid()
```

| State | Ribbon on document | Card tag colour (list) | How you enter it | How you leave it |
|---|---|---|---|---|
| draft | "DRAFT" overlay | amber `#dfa404` | created; "Convert invoice to draft"; editing a sent invoice | send by email (to the client), or "Mark it as Sent" |
| sent | "SENT" overlay | slate blue `#567189` | sent by email / marked as sent | due date passes → overdue; fully paid → paid; convert to draft |
| overdue | "OVERDUE" overlay (red) | red `#d4352c` | sent, unpaid, past due date (computed daily) | paid; convert to draft; due date edited (only via draft) |
| paid | "PAID" overlay; "PAID" stamp image on the card | stamp image | payments ≥ total (or `paid_at` set server-side) | delete a payment → back to sent or overdue |

- **There is no "partially paid", "viewed", "void" or "written off" state.** A partly paid invoice
  stays *sent* or *overdue*. The sidebar shows Paid and Owing amounts.
- The activity log does have `Paid` and `Unpaid` event types ("Invoice labeled *Paid*" and
  "Invoice labeled *Unpaid*"). The server records them when payments cross the total.
  *(from code; trigger unverified)*

### Quote status machine *(from code: `Quote.state()`)*

```
state = "declined" if declined_at
      | "accepted" if accepted_at
      | "sent"     if sent
      | "draft"
current = NOT accepted_at AND NOT declined_at
```

Quote status is set **manually** by the user from the "Quote Status" dropdown. The bundle has no
client-side accept or decline flow (see §9.6).

### Numbering *(from code + client form)*

- Every document has an integer `number`. It is displayed **zero-padded to 3 digits**
  (`paddedNumber`): 7 → `007`, 42 → `042`, 1234 → `1234`.
- `formattedNumber()` = `"<client shortname>-<padded>"` when the client has a **prefix**
  (shortname). Otherwise it is just `<padded>`. Recurring templates use the literal prefix
  `recurring-`.
- The prefix is set per client (Client form → "Invoice prefix"). Options are "New prefix", "No
  prefix (N other clients use no prefix)", or an existing prefix ("**abc** (2 clients use this
  prefix)"). The help text reads: *"Invoice numbers are generated sequentially per prefix. Eg:
  abc-001, abc-002 & xyz-001, xyz-002. If you prefer plain invoices numbers (001, 002, 003) choose
  'No prefix'."* The account flag `use_client_shortnames` sets the default for new clients.
- The server assigns the next number in the prefix's sequence when it creates a document
  *(unverified: whether quotes share the invoice sequence)*.
- The number is editable in the editor. Invalid or zero input becomes `1`. The value is rounded to
  an integer.

### Money and dates

- Amounts are formatted with the document currency's **sign** and, on totals, its **ISO code**
  (e.g. `$1,234.00 USD`).
- Dates use the locale's `date.formats.default`. In English that is `%b %-d, %Y`, e.g. "Mar 1,
  2027".

---

## 1. Invoices list — `/invoices`

### 1.1 Purpose

Shows every invoice as a filterable grid of "paper" cards, with money totals. It is also the entry
point for creating a new invoice.

### 1.2 Route and entry points

- Route `invoices` → `invoicesIndex` → `Views.Invoices.Index` (extends `Views.Documents.Index`).
  The browser title is "Current Invoices".
- Reached from the top nav **Invoices** tab, the breadcrumb on every invoice page, and the
  client-page summary links:

  | Client-page link | Opens |
  |---|---|
  | Owing | `/invoices?type=current&client_id=ID` |
  | Overdue | `/invoices?type=overdue&client_id=ID` |
  | Invoices | `/invoices?type=all&client_id=ID` |

- **Permission:** the route is registered only if `user.permissions.manage_invoices` is true
  *(from code)*.

### 1.3 Layout

1. **Page head** (blue band):
   - H1 "Invoices".
   - Button **New Invoice**. It toggles (slides open and closed) the *New Invoice action bar*
     (§2).
   - Right-aligned tabs **Invoices | Recurring**. The current tab is highlighted.
2. **Filter sentence row** (`.nav-row`), see §1.4.
3. **Links row**: "⚙ More Filters" on the left; "⬇ Download PDFs" and "📄 Download CSV" on the
   right; active filter pills.
4. **Summary bar**: four columns, PAID · OWING · OVERDUE · TOTAL.
5. **Document grid** (`.document-list`). It is server-rendered HTML from
   `GET /invoices/search.html?<filters>` and is dimmed (`opacity .5`) while loading.
6. The global footer and the right-hand tracker sidebar.

### 1.4 Filter sentence: "[Unpaid Invoices] that were [Issued] in [All time]"

| Control | Name | Options (value → label) | Default |
|---|---|---|---|
| Type select | `type` | `current` → **Unpaid Invoices** · `overdue` → **Overdue Invoices** · `paid` → **Paid Invoices** · `all` → **All Invoices** | `current` |
| "that were" select | `by` | `issued_at` → **Issued** · `due_at` → **Due** · `paid_at` → **Paid** | `issued_at` |
| "in" range select | `range` | `week` → Week · `month` → Month · `quarter` → Quarter · `year` → Year · `custom` → Custom · `all-time` → All time | `all-time` |
| Custom dates | — | two datepickers "‹start› to ‹end›". Shown only when range = Custom | — |
| Period label | — | the formatted date range plus a human label (e.g. "this month"). Shown when range is not Custom or All time | — |
| ‹ ⌂ › buttons | — | previous period / current period / next period (tooltips). **Disabled** when range is Custom or All time | — |

Coupling rules *(from code: `DocumentReport.setType`)*:

- Choosing **Unpaid** forces the range to **All time** and clears the start and end dates.
- Choosing any other type while the range is All time switches the range to **Month** (the
  current calendar month).
- The filter state is kept in the URL query string (`type`, `range`, `by`, `start`, `end`,
  `client_id`, `currency_id`). The back and forward buttons restore it (`popstate`). Any change
  re-fetches the list.

### 1.5 More Filters popover

Opened by "More Filters". It closes when you click outside it.

| Field | Type | Placeholder | Notes |
|---|---|---|---|
| **Filter by client** | client autocomplete (select2), clearable | "Any client" | |
| **Filter by currency** | currency autocomplete, clearable | "Any currency" | |
| **Apply filters** | button | | Sets `client_id` and `currency_id`, closes the popover |

Active filters appear as blue **pills**, e.g. `Client → Acme Co ×` and `Currency → USD ×`.
Clicking × removes that filter.

### 1.6 Downloads

| Link | Behaviour *(from code)* |
|---|---|
| **Download PDFs** | AJAX `GET /invoices/search.pdf?<filters>`. The server's response text is shown as a flash notice. Likely the PDFs are generated in the background and delivered later, e.g. emailed as a bundle *(unverified)*. |
| **Download CSV** | Browser navigates to `/invoices/search.csv?<filters>` (file download of the filtered list). |

### 1.7 Summary bar

Four equal columns, each with an uppercase grey heading and the amount plus currency code:

| Column | Meaning *(computed server-side over the current filter; exact formula unverified)* |
|---|---|
| PAID | Sum of payments received on the listed invoices |
| OWING | Sum of the outstanding (total − paid) amounts |
| OVERDUE | The part of OWING on overdue invoices |
| TOTAL | Sum of the invoice totals |

With mixed currencies the bar shows one currency code. That is probably the account currency, or
the currency filter when one is set *(unverified)*.

### 1.8 Card grid anatomy (`div.invoice.grid`)

Each card is a small white "sheet of paper": 132 × 166 px, with a soft shadow and skewed
pseudo-element shadows that make a page-curl effect. The cards flow left to right.

| Position | Content |
|---|---|
| Top-left | **Client badge**: a coloured square with a 2-letter monogram or the client logo, then the **invoice number** (uppercase, e.g. `042` or `ABC-007`) |
| Top-right | `.invoice-actions` dropdown toggle (a small grey square button). It is **visible only on hover**. Its menu items are server-rendered and were not captured *(unverified)* |
| Middle | **Description** in a box with grey top and bottom rules. Small grey 12px text, clipped to about 4 lines |
| Right, above the tag | **Currency code** (light grey, e.g. `USD`) |
| Left edge | **Status tag**: a flag-shaped ribbon that sticks out past the left edge, uppercase 10px white text. `draft` amber, `sent` slate, `overdue` red, (quotes: `accepted` green, `declined` red). `paid` is a "PAID" rubber-stamp image instead of a flag |
| Bottom-right | **Total**, large, with a superscript currency sign (e.g. `$1,234.00`). It turns black on hover |
| Whole card | A transparent overlay link (`a.overlay`) that opens the invoice |

- Screenshot 01 shows two overdue cards. The summary bar there reads PAID $0 · OWING · OVERDUE ·
  TOTAL.
- **Empty and loading:** while loading, the list is at reduced opacity. The empty-state text comes
  from the server and was not captured *(unverified)*.

### 1.9 Notes for our version

- The list is a grid with no columns. You cannot see the due date, days overdue or client name
  without opening a card. Offer a table view with sortable due date, age and balance columns.
- The type and range coupling (Unpaid forces All time; other types force Month) surprises users.
  Make the period independent, or show clearly that it changed.
- "Download PDFs" gives no clear feedback (flash only). Show progress and a download link.
- The summary bar is one currency only. Mixed-currency accounts need a total per currency.

### 1.10 Screenshots

`screenshots/01-invoices-list.jpg` (list), `screenshots/41-invoices-new-invoice-panel.jpg` (New
Invoice bar open).

---

## 2. New Invoice action bar (on `/invoices`)

### 2.1 Purpose

Choose a client, then either build an invoice from unbilled work or start a blank draft.

### 2.2 Layout

A row that slides open under the page title:

`New Invoice  [Select a client to invoice ▾]  [Select Tasks & Expenses]  or  [Draft Blank Invoice]`

### 2.3 Elements

| Element | Type | Details |
|---|---|---|
| Client picker | select2 autocomplete over clients (`data-type=client`), with an **"add new"** entry (`data-select2-add-new`) | Placeholder "Select a client to invoice" |
| **Select Tasks & Expenses** | button | Goes to the invoice builder for that client (§4) |
| **Draft Blank Invoice** | button | `POST /invoices {client_id}`, then shows the flash and opens `/invoices/:id/edit` |

### 2.4 Behaviours *(from code)*

- **No client chosen:** the picker **shakes** (validation feedback; no message).
- **"Add new" chosen:** a modal opens, *"Invoice for a new client"* (`documents/new_client`):

  | Field | Type | Help / validation |
  |---|---|---|
  | Business name | text, autofocus | required (`data-validates-presence`) |
  | Contact email | text | "You can add your client's email address later if you like" |
  | Billing currency | select of all 53 currencies, shown as "Name (CODE, sign)" and searchable by code | default: account currency *(unverified)* |
  | Invoice language | select of 17 locales (see §12) | |
  | Cancel / **Create Client & Invoice →** | buttons | Creates the client, then continues with the chosen action. For blank drafts the button changes to "⟳ Working…" |

- The same bar exists on Quotes, with "Select a client to quote" and a single **Draft Quote**
  button (§9.2).
- From a client page, the client's "New invoice" menu goes straight to
  `/clients/:id/invoices/new`. Adding `?for=<projectId>` limits the builder to one project.

### 2.5 Screenshot

`screenshots/41-invoices-new-invoice-panel.jpg`.

---

## 3. Invoice page — Manage mode — `/invoices/:id`

### 3.1 Purpose

Preview the invoice exactly as the client sees it. From here you print, download, send and
remind, convert to draft, set the online payment options, record payments, and read or add to the
activity history.

### 3.2 Route

- `invoices/:id` → `invoicesShow`. It loads `GET /invoices/:id` (JSON), which returns `invoice`,
  `emails`, `payments`, `activities` and `page` (the server-rendered document HTML).
- The UI locale switches to the invoice's locale while the page is shown.
- If the load fails, the user is redirected to `/invoices`.
- Browser title: "Invoice ‹formattedNumber› (‹client business name›)".
- Query parameters:

  | Parameter | Effect |
  |---|---|
  | `?email=new_invoice` | Opens the compose modal on load (used by "Send To My Client" on the public preview) |
  | `?email=reminder` | Opens the reminder compose modal on load |
  | `?email=thankyou&invoice_payment_id=N` | Opens the thank-you compose modal for that payment |

### 3.3 Layout

```
Invoices › 042
[🖨 Print][⬇ Get PDF][$ Payment Page]  [⏱ Billed Time] [⧉ Duplicate] [⊗ Delete]      (Manage Invoice | ✎ Edit Invoice)
┌──────────────── document (span-18) ───────────────┐ ┌─ sidebar (span-6) ──────────────┐
│ [logo / "Add your business's logo"]     OVERDUE ▶ │ │ [✉ Send Reminder]               │
│ From <biz>        To <client biz>   Invoice   042 │ │  or Convert invoice to draft    │
│ <contact name>    <client contact>  Date Issued   │ │ ─────────────────────────────── │
│ <address…>        <address…>        Payment Due   │ │ Payment Settings                │
│                                     Amount Due    │ │  ☐ PayPal  ☐ stripe             │
│ Description                                       │ │ Payments            [Add a payment]│
│ <invoice description>                             │ │  Paid   $0.00                    │
│ Description | Qty | Unit Price | Amount           │ │  Owing  $1,234.00                │
│ …line items…                                      │ │ Activity            [Add a note]  │
│                         Subtotal / Tax / Total    │ │  date · event …                  │
│ <footer / payment details>                        │ │                                  │
└───────────────────────────────────────────────────┘ └──────────────────────────────────┘
```

#### Header

- Breadcrumb: `Invoices › ‹formattedNumber›`.
- Toolbar (small action buttons):

  | Group | Buttons |
  |---|---|
  | First group | Print · Get PDF · Payment Page |
  | Separate | Billed Time · Duplicate · Delete |

- Right-side tabs: **Manage Invoice** (selected) and **✎ Edit Invoice**. The Edit tab has three
  variants:

  | Invoice condition | Edit tab |
  |---|---|
  | Draft | Normal link to `/invoices/:id/edit` |
  | Sent, no payments | Confirm dialog, then convert to draft and open the editor |
  | Has payments | **Disabled**, tooltip "You can't edit this invoice because payments have been added to it" |

#### Document area

The server-rendered invoice (§11). Over it sit the **status overlay ribbons** (`.overlays`):
`draft`, `sent`, `overdue` and `paid` images, 150 px wide, pinned to the top-right corner. The
current one animates its height from 0 to 100 px (0.5 s ease-out). It updates live when `sent`
changes.

#### Sidebar

From top to bottom:

1. Email button block (§3.5).
2. Payment Settings (§3.6).
3. Payments (§3.7).
4. Activity (§3.8).

#### Logo prompt

Shown only when:

- the account has no logo,
- the type is ClientInvoice,
- the browser supports `FormData`, and
- the `add_logo` notice has not been dismissed.

| Element | Details |
|---|---|
| Link | "Add your business's logo" (light-blue box) |
| **hide** | `GET /settings/notices/dismiss/add_logo` (remote) |
| File input | accepts PNG or JPEG; help text "JPG or PNG, max width 769px, max height 300px. Larger images will be resized." |
| Preview | client-side preview of the chosen file |
| Buttons | **Save Logo** (`PUT /settings/logo`, flash "Added logo to your account"; the logo then shows on all documents) · "or Choose another logo" |

### 3.4 Toolbar actions

| Button | Action | Side-effects / confirmation |
|---|---|---|
| **Print** | Opens `/invoices/:id/print` in a new tab | That page calls `window.print()` on load (§11.3) |
| **Get PDF** | Opens `/invoices/:id.pdf` in a new tab | Server-generated PDF |
| **$ Payment Page** | Opens the public page `/invoices/:id/view/:private_id` in a new tab | The owner sees an instructions banner (§11.1) |
| **Billed Time** | Opens `/time?range=all-time&invoice=:id` in the SPA | The time-log list filtered to the log entries billed on this invoice (`screenshots/34-invoice-billed-time.jpg`; see doc 04) |
| **Duplicate** | `POST /invoices/:id/duplicate` | Flash, then navigates to the **new invoice's Manage page**. The copy is presumably a draft with the next number *(unverified)*. |
| **Delete** | `DELETE /invoices/:id` after a confirm | See the dialog below. Then navigates to `/invoices` with a "deleted" flash. |

Delete confirmation dialog:

- Text: *"Are you sure you want to permanently delete this invoice? Everything will go back to how
  it was before the invoice was created: all the work it contains will be marked as unbilled
  again."*
- Buttons: "No, don't delete it" / "Yes, delete invoice".

### 3.5 Send / remind block (`invoices/email_button`)

The large blue button and the secondary link depend on the state:

| Invoice condition | Primary button (email type) | Secondary link |
|---|---|---|
| Draft (`sent` = false) | **✉ Send Invoice** (`new_invoice`) | "or **Mark it as Sent**": `PUT /invoices/:id/mark_sent`. Reloads activities and payments, then flashes |
| Sent, not overdue (includes paid) | **✉ Re-send Invoice** (`new_invoice`) | "or **Convert invoice to draft**": `PUT /invoices/:id/convert_to_draft` |
| Sent and overdue | **✉ Send Reminder** (`reminder`) | "or Convert invoice to draft" |
| Sent and has payments | (as above) | "Convert invoice to draft" asks first (see below) |

Convert-to-draft confirmation when the invoice has payments:

- Text: *"You can convert this invoice to a draft, but it's already had payments added to it.
  Converting it to a draft will **remove** all existing payments. Want to go ahead?"*
- Buttons: "No, don't convert" / "Yes, convert to draft".

**Compose email modal** *(from code; the form itself is server-rendered at
`GET /document_emails/new?document_id=:id&type=new_invoice|reminder|thankyou[&invoice_payment_id=]`
and was not captured)*:

- It opens in a fancybox modal. The subject and body are pre-filled from the account's email
  templates (§13), with variables already substituted.
- A CC address can be added with an "add address" link that reveals a CC field.
- If any variable could not be filled, the text contains `[‹var› is missing]`. A warning
  (`.liquid_warning`) appears and the **Send** button is disabled until the text is fixed.
- The email contains "View and pay this invoice online" (or "View this invoice online") with a
  link to the public page. The invoice is **attached as a PDF** (tour text).
- **On success:**
  - Flash, close the modal.
  - Add a `document_email`, reload the activities.
  - **`sent` becomes true**: the invoice moves from draft to sent and the ribbon animates.
- **Exception — sending to yourself:** if the server reports `sent_email_to_self`, the invoice
  stays a draft and a popup appears:

  > **You just sent this invoice to yourself**
  > It should arrive in your inbox in the next minute or so.
  > Does everything look good? Time to email it to your client!
  > [✉ Compose an email to my client]
  > Not ready to send this invoice to your client? *Close this popup*.

- **On failure** (e.g. the address fails validation): a hidden `skip_address_validation=1` is set
  so that a second submit goes through.
- Thank-you emails also stamp the payment's `thankyou_invoice_email` date.

### 3.6 Payment Settings box (`invoice_payments/settings`)

- Shown only if the account's plan includes PayPal or Stripe (`paypal_feature` or
  `stripe_feature`).
- Title "Payment Settings", grey prompt "Accept credit card payments for this invoice?"
- Two checkboxes, each with the brand logo as its label: **PayPal** and **Stripe**.
- A checkbox is checked when the provider is enabled on the account **and** on this invoice
  (`paypal_payment_enabled` / `stripe_payment_enabled`).
- If Stripe is connected but inactive, its label gets the class `account-inactive` (greyed).
- Toggling a box:
  - If the provider is not set up on the account yet, a setup modal opens instead (`/settings/paypal`
    or `/settings/stripe`).
  - Otherwise: `PUT /invoices/:id/update_payment_settings {paypal_payment_enabled|stripe_payment_enabled}`.
    The flash reads "PayPal payments enabled for this invoice" (or "…disabled…", or "Stripe …").
- **Default per invoice** comes from the account settings (Settings → Online Payments; see doc
  07).

### 3.7 Payments box (`invoice_payments/index`)

- **Title row:** "Payments", and a green **Add a payment** button on the right. The button is
  hidden when the invoice is **paid** or **not sent**.
- **Contents are hidden while the invoice is a draft.** They slide down when the invoice becomes
  sent.
- **Summary:**

  | Row | Value |
  |---|---|
  | Paid | `amount_paid`, 2 decimals, in a grey box. The box gets the class `complete` (green styling) when fully paid |
  | Owing | `max(0, total − amount_paid)`. Hidden when paid |

- **Add-payment form** (it slides open; `screenshots/33-invoice-add-payment-form.jpg`):

  | Field | Type | Default | Notes |
  |---|---|---|---|
  | Amount | currency text input with sign | **current amount owing** | Parsed with the currency sign and delimiters stripped. Partial payments are allowed |
  | Received date | datepicker | today | |
  | Description | textarea, 2 rows | — | placeholder "Optional payment description or notes" |
  | **Record Payment** | submit | | `POST /invoices/:id/invoice_payments {invoice_payment:{amount, received_at, description}}`. The response updates the invoice totals and activities. Flash |
  | or Cancel | link | | Hides the form and clears the description |

  There is no client-side validation of the amount. Overpayment is allowed. Owing is floored at
  0.

- **Payment list:** sorted newest received first, ties broken by newest created. Each row shows:
  - an × with the confirm "Are you sure you want to remove this payment?" (deletes the payment,
    updates the totals, and logs a "Removed payment of $X" activity)
  - the date
  - "Received $1,234.00"
  - either *(thanked on ‹date›)* or *(Send a thank-you email)*, which opens the thank-you compose
    modal
  - the payment description in quotes, if there is one.
- **Online payments** (PayPal or Stripe) appear here automatically (tour text).

### 3.8 Activity box (`document_activities`)

- Title "Activity" with a green **Add a note** button.
- The note form has a date (datepicker, default today), a "Description" textarea, **Add note** and
  "or Cancel". An empty description shakes the button. The note saves as type `Custom` via
  `POST /documents/:id/activities`.
- The feed is a scrollable panel (nanoScroller). Each entry has a delete × (confirm "Are you sure
  you want to remove this activity?"), the date, and the text:

| Activity `type` | Text rendered |
|---|---|
| `Created` | "Invoice created", or "Invoice created from a *quote*" (links to the source quote when `quote_id` is set) |
| `Sent` | "Invoice labeled *Sent*" |
| `Drafted` | "Invoice labeled *Draft*" |
| `Accepted` | "Quote was *Accepted*" |
| `Declined` | "Quote was *Declined*" |
| `Emailed` | "Emailed invoice to …", "Emailed quote to …", "Sent reminder to …" or "Sent thankyou to …", followed by the To addresses and "(CC to …)" when there was a CC. On failure: "Failed to email Invoice to ‹address›" |
| `PaymentReceived` | "Logged payment of $X" |
| `PaymentRemoved` | "Removed payment of $X" |
| `Paid` | "Invoice labeled *Paid*" |
| `Unpaid` | "Invoice labeled *Unpaid*" |
| `Updated` | "Invoice modified" |
| `Custom` | the free-text note |

In the captured feed, a typical sequence (newest first) is: reminders sent ×3, labeled Sent,
labeled Draft, reminder, labeled Sent, modified, labeled Draft, labeled Sent, emailed invoice,
created. Editing a sent invoice therefore logs *Draft → modified → Sent*.

### 3.9 Data shown

| Item | Source |
|---|---|
| Header number | `formattedNumber()` |
| Owing | `total − amount_paid`, floored at 0 |
| Overdue | `due_at < today` (local, start of day) |

### 3.10 States

| State | Shown |
|---|---|
| Loading | `loading-contents` fade-in |
| Draft | DRAFT ribbon; Payments contents hidden; "Send Invoice / Mark it as Sent" |
| Sent | SENT ribbon; "Re-send Invoice" |
| Overdue | OVERDUE ribbon; "Send Reminder" |
| Paid | PAID ribbon; Add-a-payment hidden; Owing hidden |

### 3.11 Screenshots

`15-invoice-show.jpg`, `42-invoice-show-2.jpg`, `33-invoice-add-payment-form.jpg`,
`34-invoice-billed-time.jpg`.

### 3.12 Notes for our version

- "Convert to draft" is the only way to change a sent invoice, and it **deletes all payments**.
  That is dangerous. Allow corrections (credit notes, revisions) without losing the payment
  history.
- There is no partially paid status and no void or write-off status. Add explicit
  `partially_paid`, `void` and `written_off` states and show them on cards and in filters.
- "Viewed by client" is not tracked. Logging public-page views would be a cheap and useful
  addition.
- Overdue reminders are manual only (one button). Consider automatic reminder schedules.

---

## 4. Invoice builder — "Select Tasks & Expenses" (`/clients/:id/invoices/new`) and "Add logged Time & Expenses" (`/invoices/:id/add`)

Both screens use the same view (`Views.Clients.NewInvoice`).

### 4.1 Purpose

Turn unbilled tracked time, fixed-price tasks and expenses into line items, with a **live
preview**.

| Screen | Route | Used for |
|---|---|---|
| New invoice | `/clients/:id/invoices/new` (inside the client page, `Clients.Show` subview) | Creates a new invoice |
| Add to existing | `/invoices/:id/add` (`Documents.Add`) | Appends items to an existing invoice |

Optional `?for=<projectId>` limits the builder to one project. The add screen's browser title is
"Add to Invoice ‹num› (‹client›)".

### 4.2 Entry points

- New-invoice bar → **Select Tasks & Expenses**.
- Client page → New invoice (or a project's "New invoice" menu, which passes `?for=`).
- Invoice Edit page → **⊕ Add logged Time & Expenses to this invoice**. If the editor has unsaved
  changes, a dialog asks first:
  - Heading: "You need to save your changes first"
  - Text: "You have unsaved changes. Would you like to save your changes and then add more items
    to this invoice?"
  - Buttons: [cancel] [Save and continue]

### 4.3 Layout

```
Invoices › 042 › Add                                  (Manage Invoice | Edit Invoice)
┌─ span-18 ──────────────────────────────────────┐  ┌─ span-6 ─────────────────────┐
│ ⚙ Show Options  (collapsible options panel)    │  │ [ Update this invoice  ➜ ]   │
│ ┌ INVOICE • PREVIEW • ONLY ──────────────────┐ │  │  (or "Draft this invoice" /  │
│ │ live server-rendered preview of document   │ │  │   "Draft a blank invoice")   │
│ └ INVOICE • PREVIEW • ONLY ──────────────────┘ │  │ Project name                 │
└────────────────────────────────────────────────┘  │  ☑ Task card  $X unbilled    │
                                                    │  ☑ Expense    $Y unbilled    │
                                                    │ "No unbilled tasks or expenses│
                                                    │  for ‹client›"               │
                                                    └──────────────────────────────┘
```

### 4.4 Options panel ("⚙ Show Options" / "Hide options")

Collapsed by default. The defaults come from the account's `line_item_creation_options` (Settings
→ Line Item Creation, doc 07). Changes here apply **only to this request** and are not saved back.

| Section | Control | Options / default | Notes |
|---|---|---|---|
| **Date range for this invoice** | radio `date_range` | ● **Include all unbilled time** (default) · ○ **Only time logged between** [start date] and [end date] | Datepickers with placeholders "start date" and "end date". An empty date with the range radio chosen marks the field invalid (red) |
| **Time rounding** | help text | "How should each log entry to be rounded for invoices created from billable time that you've logged?" | |
| | select `line_item_rounding_type` | `0` **No rounding** (default) · `1` **Round to nearest** · `2` **Round up to** | |
| | number `line_item_rounding_value` + "minutes" | default **5** | Hidden when "No rounding" |
| **Invoice description** | checkbox | **Include total number of hours** (default off) | Adds the total hours to the invoice description |
| | checkbox | **Include project name(s)** (default off) | |
| **Converting logged time to line items** | radio `any_grouping` | ● **Create one line item for each log entry** (default) · ○ **Group log entries together into line items** | |
| | (when grouping) checkbox + select | **Group by time period:** [day · week · month] | The select is disabled until the checkbox is on. `group_line_items_by_date` = 0, 1 or 2 |
| | (when grouping) checkbox | **Group by task** (`group_line_items_by_job`) | |
| **Line item descriptions** | checkbox | **Include project name** (default on) | |
| | checkbox | **Include task name** (default on) | |
| | checkbox | **Include billable time log descriptions** (default on) | |

### 4.5 Item picker (right column)

- Only projects with at least one expense, or a task where `canBeInvoiced` (unbilled value > 0),
  are listed.
- Each project shows its **name** (H2), then task cards, then expense cards. A project with
  nothing shows "No unbilled tasks or expenses".
- **Task card** (`jobs/invoice_fields`):
  - Task name, plus a checkbox icon (☑/☐). The whole header is clickable. Cards are **selected by
    default**.
  - Fixed-price tasks show **"Bill [$ amount] in this invoice"**: an editable currency input,
    default the unbilled fixed value, which allows partial billing. When the task also has
    unbilled hours: "Plus $X unbilled at hourly rates".
  - The value block shows "$X unbilled". For per-hour and user-rate tasks a ⓘ tooltip says
    "before rounding". Fixed-price tasks with hours show "$X / N.NN billable hours unbilled".
- **Expense card:** name, checkbox, "$X unbilled" (quantity × unit value).
- **Nothing billable for the client:** a grey box, "No unbilled tasks or expenses for ‹Client
  business name›".

### 4.6 Live preview and submit *(from code)*

- Any change to an input or select re-posts the parameters and replaces the preview HTML. The
  preview has a spinner and reduced opacity while loading.

  | Screen | Preview endpoint |
  |---|---|
  | New invoice | `POST /invoices/preview` |
  | Add to existing | `POST /invoices/:id/preview_adding_more_items` |

- The preview is framed top and bottom by "INVOICE • PREVIEW • ONLY" bands.
- The submit button label is dynamic:

  | Situation | Label |
  |---|---|
  | Add to an existing invoice | "Update this invoice" |
  | New invoice, nothing selected | "Draft a blank invoice" |
  | New invoice, items selected | "Draft this invoice" |

- Parameters sent:
  - `client_id`
  - `jobs: [{id, amount_to_invoice}]`
  - `expenses: [{id}]`
  - `include_total_hours_in_invoice_description`, `include_project_names_in_invoice_description`
  - `options: {line_item_rounding_type, line_item_rounding_value, include_block_descriptions_in_line_item_descriptions, include_project_names_in_line_item_descriptions, include_job_names_in_line_item_descriptions, group_line_items_by_job, group_line_items_by_date}`
  - `start_date`, `end_date`
- **Submit:**
  - New: `POST /invoices`. Add: `POST /invoices/:id/add_items`.
  - Then flash and navigate to the **invoice Manage page**.
- **Side-effect:** the included log entries and expenses become **billed**, linked to this invoice.
  This is what "Billed Time" lists, and deleting the invoice un-bills them again.
- Time line items are `TimeLineItem`s: quantity in hours, rate per hour (see §5.5).

### 4.7 Screenshots

`37-invoice-add-time-expenses.jpg` (collapsed), `38-invoice-add-time-expenses-options.jpg`
(expanded).

### 4.8 Notes for our version

- The preview is a server round-trip on every keystroke or change, which feels slow. Render it on
  the client.
- You can select whole tasks but not individual log entries. A per-entry tick list (with date
  filtering) would give finer control.
- The rounding and grouping options are buried under "Show Options". Remember the last-used
  choice per client.

---

## 5. Invoice editor — Edit mode — `/invoices/:id/edit`

### 5.1 Purpose

A WYSIWYG editor laid out like the printed document. Every part of the document is editable here.

### 5.2 Route

- `invoices/:id/edit` → `GET /invoices/:id/edit`, which returns `invoice`, `taxes`, `line_items`
  and `preset_line_items`.
- Title: "Edit Invoice ‹num› (‹client›)".
- **Reachable only for drafts.** For a sent invoice the Edit tab first converts it to a draft
  (with a confirm). With payments, the Edit tab is disabled.

### 5.3 Layout

- **Header:**
  - Breadcrumb `Invoices › 042 › Edit`.
  - Action **⊕ Add logged Time & Expenses to this invoice**.
  - Tabs Manage Invoice | ✎ Edit Invoice (selected).
- **Document form** (span-18): white page. See §5.4 for the fields.
- **Sidebar** (span-6, sticky `.follow`):
  - Large **Save Changes** submit.
  - "or **Discard changes**" (a link back to the Manage page).
  - **Taxes** panel (collapsible title with a ⚙ cog).

### 5.4 Fields

| Area | Field (`name`) | Type | Placeholder | Default source | Notes |
|---|---|---|---|---|---|
| Logo bar | — | uploader | | account logo | Same widget as §3.3 |
| **From** (label i18n `from`) | `account_business_name` | text | "Your business name" | account business name | Snapshotted per document. The tour says "These details will be used on all future invoices" (the server probably copies them back to the account; *unverified*) |
| | `account_contact_name` | text | "Your name" | account billing contact | |
| | `account_address` | textarea, 4 rows | "Your address" | account address | Free text. Line breaks are kept |
| **To** (`to`) | `client_business_name` | text | "Recipient's business name" | client business name | Editable per document without changing the client |
| | `client_contact_name` | text | "Recipient's name" | client contact | |
| | `client_address` | textarea, 4 rows | "Recipient's address" | client address | |
| **Number block** | prefix label | static | | `shortname - ` | Shown only if the client has a prefix |
| | `padded_number` | text (narrow) | | next number | Displayed padded to 3 digits. Parsed to an integer; 0 or NaN becomes 1 |
| | type heading | static | | | "Invoice", or **"Tax Invoice"** when the invoice has at least 1 tax (i18n `tax_invoice`) |
| **Dates** | `issued_at` — "Date Issued:" | datepicker | | today | |
| | `due_at` — "Payment Due:" | datepicker | | issued + payment terms | |
| | `due_at_offset` — "Due [ N ] days from issue" | small text | | account **Payment terms** (default 7) | Two-way binding, see below |
| **Description** (`description` heading) | `description` | autogrow textarea, 2 rows | — | blank, or generated by the builder | Rendered as Markdown on the document |
| **Line items table** | see §5.5 | | | | |
| **Totals** | Subtotal, one row per tax "‹Name› (‹pct›)", Total | computed | | | Formatted `sign + amount + code` |
| **Footer** | `footer` | autogrow textarea | "Payment Details" (invoices) / "Terms and Conditions" (quotes) | Settings → Invoice footer / Quote footer | Typically bank details. Markdown and line breaks are kept |

Due-date binding rules *(from code)*:

- Changing **Date Issued** or **days** sets `due_at = issued_at + offset days`.
- Changing **Payment Due** sets `offset = round((due_at − issued_at) / 1 day)`.
- If the issued date is empty it is derived back from the due date and the offset.

### 5.5 Line items

- Table columns:
  - a gutter (drag handle and × delete, visible on hover)
  - **Description**
  - **Qty**
  - **Unit Price**
  - one checkbox column per tax (header = tax name)
  - **Amount** (right-aligned, grey, read-only)

| Field | Type | Behaviour |
|---|---|---|
| `description` | autogrow textarea, 1 row | **Markdown** (rendered with `marked`). `**bold**` becomes bold, blank lines start new paragraphs. Builder-generated items wrap the project and task name in `**…**` |
| `quantity` | text | Normal items: parsed as a float (invalid becomes 0) and shown with sensible precision. **`TimeLineItem`**: stored in **seconds**, entered as `H:MM` or decimal hours (`1.5`), shown as `H:MM`. Minutes ≥ 60 roll over |
| `rate` | text | Currency string parsed to a number. Shown with the sign. For time items the suffix "/ h" is shown |
| Tax checkbox `includes_tax` | checkbox per tax | Default **checked** (`applies: true`) |
| Amount | computed | `qty × rate`. For time items: `seconds / 3600 × rate` |
| `position` | hidden | Set on drag-reorder. Reordering is enabled only when there are ≥ 2 items |
| × (remove) | link | Removes the row. Saved items are flagged `_destroy` |

Below the table, a split button: **Add a line item** plus a ▾ caret
(`screenshots/35-invoice-edit-line-item-menu.png`).

- **Add a line item** adds a row with qty 1, rate 0 and an empty description.
- The ▾ menu lists the **preset line items**. Each entry shows its Markdown-stripped description;
  clicking it adds a row with that description and rate, qty 1. Then comes a divider and
  **✎ Manage your preset line items**, which opens `/settings/documents/inventory` in a new tab.
  With no presets, only the manage link shows.
- Freeform (public) documents have a plain "Add a line item" link with no presets.

### 5.6 Taxes panel (sidebar)

`screenshots/36-invoice-edit-taxes-panel.jpg`

- A collapsible box titled **Taxes** with a ⚙ icon. Clicking the title toggles it.
- Empty state: "There aren't any taxes on this document".
- **Add a Tax** adds a row with Name "Tax" and Percentage "10%". The input is focused.
- **At most 2 taxes:** the "Add a Tax" link is hidden when there are 2.
- Each row: `name` (placeholder "Name", required) · `percentage` (placeholder "Percentage";
  accepts "10" or "10%", re-formatted on blur) · × delete.
- Adding a tax:
  - adds a tax checkbox column to **every** line item (checked by default)
  - adds a total row "‹Name› (‹pct›)"
  - changes the heading to "Tax Invoice".
- Tax maths *(from code)*:
  - `tax_i = Σ (pct_i/100 × line.subtotal)` over the lines where that tax applies
  - `total = subtotal + tax_0 + tax_1`
  - Taxes are exclusive, never compound, and there is no per-line rounding.
- New documents start with the account's **Default Taxes** (Settings → Defaults, up to 2).

### 5.7 Save and leave

- **Save Changes:**
  - The button changes to "Saving…".
  - `PUT /invoices/:id` with `{invoice:{currency_id, locale, number, issued_at, due_at, description, footer, line_items_attributes[], taxes_attributes[], account_*, client_*, paypal_payment_enabled, stripe_payment_enabled}}`.
  - On success: mark clean, flash, go to the Manage page.
  - On error: the button reverts to "Save". Server validation messages were not captured
    *(unverified)*.
- **Unsaved-changes guard:** any change marks the page dirty. Navigating away asks: *"You haven't
  saved your changes to the invoice 042. Are you sure you want to discard your changes?"* The
  browser `beforeunload` is hooked too.
- The **locale and currency** of a client document come from the client (or a per-document
  override). There is **no currency or language selector** in the client invoice editor. Only the
  free tool has one (§10).

### 5.8 Screenshots

`16-invoice-edit.jpg`, `35-invoice-edit-line-item-menu.png`, `36-invoice-edit-taxes-panel.jpg`.

### 5.9 Notes for our version

- The limit of 2 taxes and the lack of compound or inclusive tax will not fit many regions. Model
  taxes as a list with inclusive and compound flags.
- There is no discount line, no per-line date column, and no item units (hrs, pcs). Consider
  adding them.
- Editing a sent invoice silently resets it to draft and requires re-sending. Consider
  "edit and keep sent" with a revision log.
- Markdown in line items is powerful but invisible: there is no hint or toolbar. Add a hint or a
  light formatting toolbar.

---

## 6. Payments (model and rules)

| Rule | Detail *(from code)* |
|---|---|
| Who can add | Any user with `manage_invoices`, and only on a **sent**, **unpaid** invoice |
| Partial payments | Yes, any amount. The default is the full amount owing |
| Overpayment | Not blocked. Owing shows 0 |
| Paid detection | `paid_at` set, or (≥ 1 payment and owing ≤ 0) |
| Removing a payment | Confirm. Logs "Removed payment of $X". The invoice reverts to sent or overdue |
| Converting to draft | **Removes all payments** (after the confirm) |
| Online payments | Recorded automatically by the PayPal or Stripe integration (§11.2) |
| Thank-you email | Per payment, manual. Remembers the date it was sent ("thanked on") |
| Editing an invoice that has payments | Blocked (the Edit tab is disabled) |

---

## 7. Duplicate, delete, mark as sent: endpoints summary *(from code)*

| Action | Method and URL | Result |
|---|---|---|
| Create blank | `POST /invoices {client_id}` | `{invoice, flash}` → edit page |
| Create from work | `POST /invoices {client_id, jobs, expenses, options…}` | → Manage page |
| Preview build | `POST /invoices/preview` | HTML |
| Add items | `POST /invoices/:id/add_items` | → Manage page |
| Preview add | `POST /invoices/:id/preview_adding_more_items` | HTML |
| Load (show) | `GET /invoices/:id` | `{invoice, emails, payments, activities, page}` |
| Load (edit) | `GET /invoices/:id/edit` | `{invoice, taxes, line_items, preset_line_items}` |
| Load (add) | `GET /invoices/:id/add?include_completed_jobs=true` | `{invoice, projects}` |
| Save | `PUT /invoices/:id` | `{invoice, flash}` |
| Mark sent | `PUT /invoices/:id/mark_sent` | `{activities, payments, flash}` |
| Convert to draft | `PUT /invoices/:id/convert_to_draft` | same |
| Payment settings | `PUT /invoices/:id/update_payment_settings` | |
| Duplicate | `POST /invoices/:id/duplicate` | `{invoice, flash}` |
| Delete | `DELETE /invoices/:id` | `{flash}` |
| Payments | `POST` / `DELETE /invoices/:id/invoice_payments[/:pid]` | `{invoice, invoice_activities, flash}` |
| Activities | `POST` / `DELETE /documents/:id/activities[/:aid]` | |
| Compose email | `GET /document_emails/new?document_id=&type=new_invoice\|new_quote\|reminder\|thankyou[&invoice_payment_id=]` | form HTML (remote submit) |
| List | `GET /invoices/search.html` · `.csv` · `.pdf` with filters | |
| Print / PDF | `GET /invoices/:id/print` · `/invoices/:id.pdf` | |
| Public | `GET /invoices/:id/view/:private_id` (`/print`, `.pdf`) | |

---

## 8. Recurring invoices

### 8.1 Concept

A **RecurringInvoice** is a template invoice with a schedule:

- **every** `interval` × `week | month | year` (`every` = 0, 1 or 2)
- starting on `recurring_start_date`
- with an `enabled` flag.

On each scheduled date the server generates a normal **draft** ClientInvoice from the template and
**emails the account owner**. Generated invoices are **not sent to the client automatically**
(help box text).

### 8.2 List — `/invoices/recurring`

- Route `invoices/recurring` → `GET /recurring_invoices` (JSON) → `Views.RecurringInvoices.Index`.
  Title "Recurring Invoices".
- **Header:** breadcrumb `Invoices › Recurring invoices`; button **Create a Recurring Invoice**;
  tabs Invoices | **Recurring**.
- **Intro box** (until dismissed via `/settings/notices/dismiss/about_recurring`):
  - **Do you bill your clients at regular intervals?**
  - With Recurring Invoices you can automatically generate invoices according to a schedule. When
    a new invoice is generated we'll email you to let you know.
  - You'll have a chance to review and edit the drafted invoice before sending it to your client.
    Generated invoices are *not* sent to your client automatically.
  - [Ok, got it!]
- **Empty state:** "You haven't created any recurring invoices. *Learn how to create a recurring
  invoice*" (links to `/help/guides/invoicing/recurring`).
- **Table** (`recurring_invoices/list`):

| Column | Content |
|---|---|
| **Number** | Link: `recurring-001` |
| **Client** | Client badge and business name |
| **Details** | Description (Markdown stripped), or grey "(no description)". Below it the total (`$1,234.00`) and a ✎ "Edit template" icon link |
| **Schedule** | **"Every 1 month on the 1st day of the month"** in bold (see the phrases below). Then "Next invoice – ‹date›". When disabled the date is struck through, with "(disabled)". A ✎ "Edit schedule" link |
| **Active** | ✓ or ✗ icon, plus an inline "disable" or "enable" link |

Schedule phrases (`humanOn`):

| Unit | Phrase |
|---|---|
| Week | the weekday name, e.g. "Monday" |
| Month | "the ‹Nth› day of the month" (`on` = 31 becomes "the last day of the month") |
| Year | "the ‹Do of MMMM› of the start date", e.g. "the 1st of March" |

The `every` word is pluralised when the interval is greater than 1 ("Every 2 months on …").

### 8.3 Create modal ("New Recurring Invoice")

| Field | Type | Default | Help / validation |
|---|---|---|---|
| **Client** | client autocomplete, clearable | — | Placeholder "Select a client to invoice". Required |
| **Repeat every** | number (min 1) + select **week(s) / month(s) / year(s)** | 1 month(s) | "How often should an invoice be created?" Values < 1 are clamped to 1 |
| **Starting on** | datepicker (min date today) | today | "And when should the first invoice be created?" |
| **Schedule** | read-only list | | The next **4** dates, each "Mon March 1, 2027 · *3 months from now*". Recomputed live |
| **Compose Invoice ➜** / or cancel | buttons | | Validates (shakes if invalid). Then `POST /recurring_invoices`, flash, navigate to `/recurring_invoices/:id` |

Start-date normalisation *(from code)*: if the stored start date is in the past, it is rolled
forward by whole intervals to the next occurrence on or after today.

### 8.4 Recurring show ("Preview Invoice") — `/recurring_invoices/:id`

- **Header:**
  - An `enabled` (green) or `disabled` label before the H1.
  - Breadcrumb `Recurring Invoices › recurring-001`.
  - Actions:

    | Action | Behaviour |
    |---|---|
    | ⊗ **Delete** | Confirm: *"Are you sure you want to permanently delete this recurring invoice? Deleting this recurring invoice will not delete any invoices that have been generated from it."* Buttons "No, don't delete it" / "Yes, delete invoice". Then goes to the list |
    | **Enable / Disable Recurring Invoice** | Toggle. `PUT /recurring_invoices/:id/enable` or `/disable`, flash |

  - Tabs: **Preview Invoice | Schedule | ✎ Edit Template**.
- **Body:** the document preview, framed by "RECURRING • INVOICE • TEMPLATE" bands. Sidebar:
  **Generate an invoice now**, which posts to `/recurring_invoices/:id/duplicate` and then opens
  the new invoice's Manage page.
- Title "Recurring Invoice ‹num› (‹client›)".

### 8.5 Edit template — `/recurring_invoices/:id/edit`

- The same document editor (§5), with these differences:
  - Breadcrumb `Recurring Invoices › recurring-001 › Edit Template`, with the Enable/Disable
    actions.
  - **No number field and no dates.** An info box reads: "Recurring invoices have their number,
    issued date, and due date set automatically".
  - Presets are available.
- Saving also sends `recurring_start_date, every, interval, client_id`, then goes back to the
  preview.

### 8.6 Schedule — `/recurring_invoices/:id/schedule`

- Title "Edit Schedule: Recurring Invoice ‹num› (‹client›)".
- Two boxes:
  - **Schedule** (left): the same Repeat every / Starting on fields as §8.3, and **Save
    Schedule**.
  - **Upcoming** (right): the next 4 dates with "N from now".

### 8.7 Notes for our version

- There is no end date, occurrence count or "on day N of the month" control. `on` is derived from
  the start date. Add an end condition and an explicit day-of-month or weekday.
- There is no auto-send option. Many users want "generate and email the client". Make it opt-in.
- Templates cannot pull in unbilled time automatically (fixed lines only). A "bill all unbilled
  time for client" option would be powerful.
- The list does not show the history of generated invoices. Link generated invoices back to their
  template.

### 8.8 Screenshots

`17-invoices-recurring.jpg` (empty state; the account had no recurring invoices).

---

## 9. Quotes

### 9.1 List — `/quotes`

- Route `quotes` → `Views.Quotes.Index`. Title "Current Quotes". Permission: `manage_invoices`.
- **Header:** H1 "Quotes", **New Quote** button (toggles the bar). There are no secondary tabs.
- **Filter sentence:** `[Current Quotes ▾] that were [Issued ▾] in [range ▾] ‹ ⌂ ›`

| Control | Options (value → label) | Default |
|---|---|---|
| `type` | `current` → **Current Quotes** (neither accepted nor declined) · `accepted` → **Accepted Quotes** · `declined` → **Declined Quotes** · `all` → **All Quotes** | current |
| `by` | `issued_at` → Issued · `accepted_at` → Accepted · `declined_at` → Declined | issued_at |
| `range` | Week / Month / Quarter / Year / Custom / All time | all-time |

- The same coupling rules apply (Current forces All time; other types force Month). The same More
  Filters (client, currency), Download PDFs and Download CSV (`/quotes/search.*`) apply.
- The grid uses the same card component, with tags `draft`, `sent`, `accepted` (green) and
  `declined` (red). A summary bar is presumably shown too *(unverified: quotes were empty in the
  capture)*.
- The client page "Quotes" summary links to `/quotes?type=all&client_id=ID`.

### 9.2 New Quote bar

- `New Quote [Select a client to quote ▾] [Draft Quote]`.
- Same add-new-client modal ("Quote for a new client", "Quote language", "Create Client & Quote").
- **Draft Quote** posts `POST /quotes {client_id}`, shows the flash, and opens
  `/quotes/:id/edit`.
- There is **no "from tasks" builder** for quotes.

### 9.3 Quote editor — `/quotes/:id/edit`

- The same editor as §5, with these differences:
  - Breadcrumb `Quotes › ‹num› › Edit`.
  - Tabs **Manage Quote | ✎ Edit Quote**.
  - The heading is "Quote".
  - **Only "Date Issued"**: no due date and no offset.
  - The footer placeholder is "Terms and Conditions" (default: Settings → Quote footer).
  - Taxes and presets work as on invoices.
  - There is no "Add logged time" action.
- If the quote is sent, the Edit tab confirms: *"You can edit this quote, but you've already marked
  it as sent. Editing it will convert it back to a draft. Want to go ahead?"* Buttons "No, don't
  edit" / "Yes, edit it". It calls `PUT /quotes/:id/mark_draft`.
- Unsaved-changes guard text: "…changes to the quote ‹num›".

### 9.4 Quote show — `/quotes/:id`

- Title "Quote ‹num› (‹client›)".
- **Toolbar:**

  | Group | Buttons |
  |---|---|
  | First group | 🖨 Print (`/quotes/:id/print`) · ⬇ Get PDF (`/quotes/:id.pdf`) · 🌐 **View Online** (`/quotes/:id/view/:private_id`) |
  | Second group | ⧉ Duplicate (`POST /quotes/:id/duplicate`, then opens the new quote) · 📄 **Create Invoice** |
  | Separate | ⊗ Delete (confirm "Are you sure you want to permanently delete this quote?", buttons "No, don't delete it" / "Yes, delete quote") |

- **Document:** the quote, with status overlays `draft`, `sent`, `accepted` and `declined`. The
  ribbon refreshes when `sent`, `accepted_at` or `declined_at` changes.
- **Sidebar:**
  1. **✉ Send Quote**, or **Re-send Quote** once sent (email type `new_quote`). While a draft:
     "or **Mark it as Sent**" (`PUT /quotes/:id/mark_sent`). The "sent to yourself" popup reads
     "You just sent this quote to yourself…".
  2. A large **📄 Create Invoice** button.
  3. **Quote Status**: a dropdown button showing the current state (e.g. "Sent ▾"). The menu
     items are **Draft**, **Sent**, **Accepted** and **Declined**, each with a check-box icon; the
     current one is checked. Choosing one calls `PUT /quotes/:id/mark_<state>` (a spinner replaces
     the caret), then reloads the activities and flashes.
  4. **Activity** (same component as invoices). It shows "Quote was *Accepted*" and "Quote was
     *Declined*".
- There are **no payments** on quotes.

### 9.5 Convert to invoice

- **Create Invoice** (toolbar or sidebar) calls `POST /quotes/:id/convert_to_invoice` and opens
  the **new invoice's Manage page**.
- The invoice records `quote_id`. Its first activity reads "Invoice created from a *quote*" (a link
  back).
- The quote's own state is not changed by the client code. Whether the server marks it accepted is
  *unverified*.
- The quote can be converted several times; there is no guard in the UI.

### 9.6 Client acceptance

- The public quote page is `/quotes/:id/view/:private_id` (not captured).
- The bundle has **no accept or decline action for the client**. Status changes go through the
  owner's Quote Status dropdown. Any public "Accept" button would be server-rendered
  *(unverified; probably absent)*.
- Marketing copy for the free tool says: "send quotes by email, mark them as accepted or declined,
  and turn them into invoices". That suggests acceptance is marked manually.

### 9.7 Notes for our version

- Add client-side acceptance (an Accept or Decline button with name and signature on the public
  page) and expiry ("valid until") dates.
- Converting a quote should automatically mark it accepted (or ask) and link both ways. It should
  also guard against double conversion.
- Quote numbering versus invoice numbering is unclear. Make the sequences separate and explicit.
- A quote → deposit invoice (partial %) flow is missing.

---

## 10. Free Invoice / Quote tool (public, logged-out) — `/free_invoice_creator`, `/free_quote_template`

### 10.1 Purpose

A marketing lead-magnet. Anyone can build an invoice or quote without an account. It uses the same
editor with `FreeformInvoice` / `FreeformQuote`.

### 10.2 What was captured

When logged in, both URLs show the app shell with a flash: "Welcome back, ‹name›. Just click the
'New Invoice' button to get started." (or "…'New Quote'…"). The editor layout below comes from the
templates *(from code)*.

### 10.3 Layout *(from code)*

- **Hero:** "Free Invoice Template — Make an invoice to print, or download as a PDF". The copy
  upsells: "Want to track payments, accept credit cards, and be automatically notified of late
  invoices? Check out our online invoicing features or start a free trial."
  - Quote version: "Free Quote Template … Want to send quotes by email, mark them as accepted or
    declined, and turn them into invoices?…"
- **Card editor:** the same fields as §5 (From, To, Number with a `#` prefix, Date Issued, Payment
  Due with no offset helper, Description, line items with a plain "Add a line item", totals,
  footer).
- **Sidebar:**

  | Control | Action |
  |---|---|
  | **💾 Save Invoice** | modal `/free_invoice_creator/save` (sign-up gate) |
  | **✉ Send Invoice** | modal `…/send_by_email` |
  | Print Invoice | prints |
  | **Download PDF** | modal `…/get_pdf` |
  | **Taxes** box | same as §5.6 |
  | **Language & Currency** box | two selects: locale (17) and currency (53, "Name (CODE, sign)") |

  Changing the locale or currency re-renders the editor with translated labels.

### 10.4 Notes for our version

- The free tool is a good acquisition funnel. Its save, send and PDF actions all gate behind
  sign-up. Consider an equivalent that converts the draft into the new account on sign-up.

---

## 11. Client-facing document: public page, print, PDF

### 11.1 Public "Payment Page" — `/invoices/:id/view/:private_id`

- **Purpose:** the client-facing invoice. It is unauthenticated and protected by a 32-character
  random `private_id` hash. The email link points here.
- **Title:** "Invoice ‹num› - Powered by Paydirt Billing". The page is `noindex`.
- **Owner-only banner** (shown when the logged-in owner views it):
  - Text:
    - This is how Invoice 042 will appear to your client. From this page, your client can:
      - Print the invoice.
      - Download a PDF copy of the invoice.
    - *Set up PayPal or Stripe* and your client will be able to pay this invoice with their credit
      card.
    - When they view this page, your client will not see this message, or any of your other
      invoices or clients.
  - Button: **✉ Send To My Client** (goes to `/invoices/:id?email=new_invoice`).
- **Body:**
  - Left (span-18): the invoice document (§11.4) with the status overlays. In the capture,
    overdue was current, with paid also present.
  - Right (span-6):
    - An "amount due" box: **$1,234.00 USD Due**.
    - **🖨 Print Invoice** (`…/view/:hash/print`).
    - **⬇ Download PDF** (`…/view/:hash.pdf`).
    - The payment buttons (PayPal or Stripe) **when enabled** on the invoice. Not captured, since
      payments were disabled *(unverified layout)*.
  - Footer: a Paydirt link.
- **Public quote page:** `/quotes/:id/view/:private_id`, "View this quote online" (not captured).

### 11.2 Online payment *(from code + tour text)*

- The client pays by card through Stripe, or through PayPal (card or PayPal balance).
- The payment is recorded automatically on the invoice (Payments box and activity log).
- Turning payments on or off per invoice is described in §3.6.
- Account setup (connecting Stripe or PayPal) is in Settings → Online Payments, doc 07.

### 11.3 Print layout — `/invoices/:id/print` (and `/view/:hash/print`)

- A minimal HTML page with the print stylesheet. It auto-runs `window.print()`.
- It contains only the document (§11.4), titled "Paydirt". There are no status overlays and no
  app chrome.

### 11.4 Document structure (shared by Manage preview, public, print and PDF)

```
[logo bar — account logo if any]
┌ From ‹account business name› ─┬ To ‹client business name› ─┐  ┌ Invoice            ‹number› ┐
│ ‹account contact name›        │ ‹client contact name›      │  │ Date Issued:   Mar 1, 2027 │
│ ‹account address (multi-line)›│ ‹client address›           │  │ Payment Due:   Mar 8, 2027  │
└───────────────────────────────┴────────────────────────────┘  │ Amount Due:  $1,234.00 USD  │
                                                                └─────────────────────────────┘
Description
‹invoice description (markdown → <p>)›

| Description                         | Qty | Unit Price | [Tax1] [Tax2] | Amount    |
| **Line item description** (md)      | 1   | $1,234.00  |               | $1,234.00 |
(rule)
                                              Subtotal        $1,234.00 USD
                                              ‹Tax› (10%)       $123.40 USD   (per tax)
                                              Total           $1,357.40 USD
‹footer (payment details / terms), markdown, line breaks preserved›
```

- **Labels are localised** by the document locale (i18n keys):

  | Key | English |
  |---|---|
  | `from` | From |
  | `to` | To |
  | `invoice` | Invoice |
  | `tax_invoice` | Tax Invoice |
  | `quote` | Quote |
  | `date_issued` | Date Issued |
  | `payment_due` | Payment Due |
  | `amount_due` | Amount Due |
  | `description` | Description |
  | `line_item.description` | Description |
  | `line_item.quantity` | Qty |
  | `line_item.unit_price` | Unit Price |
  | `line_item.amount` | Amount |
  | `subtotal` | Subtotal |
  | `total` | Total |

  The number and date formats are localised too.
- **Rows alternate** (`odd`/`even`).
- The **Amount Due** in the header box is the outstanding amount *(unverified: total − paid
  versus total)*.
- Quotes omit Payment Due and Amount Due *(unverified for Amount Due)*.

### 11.5 PDF — `/invoices/:id.pdf`

- Generated server-side from the same layout. It is attached to the outgoing emails.
- Bulk PDFs come from the list's "Download PDFs".

### 11.6 Notes for our version

- The public page has no branding beyond the logo, and the client cannot see their payment
  history. Show received payments and the remaining balance.
- No "viewed" tracking. Log the first and last view per recipient.
- The private hash URL never expires and cannot be revoked. Add regenerate and revoke.

---

## 12. Multi-currency and language

| Aspect | Behaviour *(from code)* |
|---|---|
| Currency per client | Each client has a `currency_id` (billing currency), chosen at client creation (53 currencies in `data_all.json`, each with `code`, `sign` and `name`) |
| Currency per document | `document.currency_id`, falling back to the client currency. It is sent on save. The client-invoice editor has no picker; the free tool does |
| Display | The sign is placed according to the locale's number format. Totals append the ISO code (`$5.00 USD`). Ambiguous signs ($) are disambiguated only by the code |
| Locale per client and document | `locale`, falling back to the client locale. 17 options: Czech (`ces`), Dansk (`da`), Deutsch (`de`), English (`en`), Español (`es`), Fārsi (`fas`), Français (`fr`), Magyar (`hun`), Íslenska (`isl`), Italiano (`it`), Nederlands (`ne`), Norsk (`nor`), Polski (`pol`), Português Brasileiro (`pt-BR`), Romanian (`ron`), Svenska (`sv`), Türkçe (`tr`) |
| UI locale switch | While a document is shown or edited, `I18n.locale` is set to the document locale. Dates in the editor follow that locale. It resets on navigation |
| List filtering | "Filter by currency" in More Filters. The summary bar shows a single currency code |
| Payments | Recorded in the invoice currency. There are no exchange rates and no base-currency conversion anywhere |

Notes for our version:

- Reports and summaries do not convert currencies. Either convert at a stored rate, or group
  totals by currency.
- Allow a per-invoice currency override in the editor; today you can only switch by changing the
  client.

---

## 13. Emails sent

The templates are edited in Settings → Email Templates (doc 07). The defaults are below. Variables
use `{{ var }}` and are substituted when composing. Missing values become `[var is missing]`,
which blocks sending.

| Template (id) | Trigger | Default subject | Default body |
|---|---|---|---|
| **Sending a quote** (`quote_email`) | Send / Re-send Quote | `New quote {{ quote_number }} from {{ our_contact_name }}` | Hello {{ client_contact_name }}, / Please find attached quote {{ quote_number }}. / Regards, {{ our_contact_name }} |
| **Sending an invoice** (`invoice_email`) | Send / Re-send Invoice | `New invoice {{ invoice_number }} from {{ our_contact_name }}` | Hello {{ client_contact_name }}, / Please find attached invoice {{ invoice_number }}, due {{ invoice_due_date }}. / Regards, {{ our_contact_name }} |
| **Overdue invoice reminder** (`invoice_reminder_email`) | Send Reminder (overdue only) | `Overdue invoice {{ invoice_number }} from {{ our_business_name }}` | Hello {{ client_contact_name }}, / Please find attached invoice {{ invoice_number }}, which was due on {{ invoice_due_date }}. / This invoice is now {{ invoice_days_overdue }} days overdue. We would appreciate your prompt attention to this matter. / Regards, {{ our_contact_name }} |
| **Thanks for your payment** (`invoice_thankyou_email`) | "Send a thank-you email" on a payment | `Thanks for your payment of invoice {{ invoice_number }} from {{ our_contact_name }}` | Hello {{ client_contact_name }}, / Thanks, your payment of {{ invoice_payment_amount }} for invoice {{ invoice_number }} has been received. / Regards, {{ our_contact_name }} |

Available tags (the picker in the template editor):

| Tag | Meaning | Available in |
|---|---|---|
| `{{ client_business_name }}` | The client's business name | all |
| `{{ client_contact_name }}` | The client's full name | all |
| `{{ client_contact_first_name }}` | The client's first name | all |
| `{{ our_business_name }}` | Your business name | all |
| `{{ our_contact_name }}` | Your business billing contact name | all |
| `{{ invoice_number }}`, `{{ invoice_due_date }}`, `{{ invoice_total }}`, `{{ invoice_description }}` | Invoice fields | invoice templates |
| `{{ invoice_days_overdue }}` | Days since due | reminder only |
| `{{ invoice_payment_amount }}` | Payment amount | thank-you only |
| `{{ quote_number }}`, `{{ quote_total }}`, `{{ quote_description }}` | Quote fields | quote template |

The template preview uses sample data: "The Bluth Company", "Michael Bluth", "blu-001", $2,450,
"Monthly land surveying fee for October".

### Other emails *(from help and tour text; not captured)*

| Email | When |
|---|---|
| To the account owner | When an invoice **falls overdue** ("You will be notified if your invoice falls overdue") |
| To the account owner | When a **recurring invoice is generated** |
| To the account owner | Probably when an online payment is received *(unverified)* |

Each client-facing email includes the link "View and pay this invoice online" (or "View this
invoice online" / "View this quote online") and the document **PDF attachment**.

---

## 14. Data model (invoice-related) *(from code)*

### 14.1 Invoice / Quote (`Paydirt.Models.Document` → `Invoice`, `Quote`)

| Attribute | Type | Notes |
|---|---|---|
| `id` | int | |
| `type` | enum | `ClientInvoice`, `RecurringInvoice`, `FreeformInvoice`, `ClientQuote`, `FreeformQuote` |
| `client_id` | int | |
| `number` | int | Shown padded to 3 digits, with the client prefix |
| `currency_id`, `locale` | int / string | Fall back to the client's |
| `issued_at` | date | Sent as `YYYY-MM-DD`. Quotes send `YYYYMMDD` |
| `due_at` | date | Invoices only |
| `due_at_offset` | int (client-side) | Days between issued and due |
| `description` | text (markdown) | |
| `footer` | text (markdown) | |
| `account_business_name`, `account_contact_name`, `account_address` | text | "From" snapshot |
| `client_business_name`, `client_contact_name`, `client_address` | text | "To" snapshot |
| `subtotal`, `total` | money | Plus client-side `tax0` and `tax1` |
| `amount_paid` | money | Invoices |
| `paid_at` | datetime | Invoices |
| `sent` | bool | |
| `accepted_at`, `declined_at` | datetime | Quotes |
| `private_id` | string(32) | Public URL hash |
| `paypal_payment_enabled`, `stripe_payment_enabled` | bool | Invoices |
| `quote_id` | int | Invoice created from a quote |
| `created_at` | datetime | |
| **Recurring only:** `interval` (int ≥ 1, default 1), `every` (0 week / 1 month / 2 year, default month), `on` (weekday 0–6, or day of month 1–31 with 31 = last; default 1), `recurring_start_date` (date, default today), `enabled` (bool), `upcoming_recurring_dates` (date[]) | | |

Child collections:

- `line_items`
- `taxes` (InvoiceTax)
- `payments` (InvoicePayment)
- `emails` (DocumentEmail)
- `activities` (DocumentActivity)

### 14.2 LineItem

| Attribute | Notes |
|---|---|
| `id`, `type` | `TimeLineItem` for hours, otherwise a quantity item (name not seen; *unverified*) |
| `description` | Markdown |
| `quantity` | Float, or **seconds** for time items |
| `rate` | Money per unit, or per hour |
| `subtotal` | Computed |
| `position` | Sort order |
| `_destroy` | Flag |
| `line_item_taxes[]` | `{id, line_item_id, tax_id/tax_cid, applies (default true)}` |

### 14.3 InvoiceTax (per document) / Tax (account default)

`{id, name (default "Tax"), percentage (default 10), _destroy}`. At most 2 per document and at most
2 account defaults.

### 14.4 InvoicePayment

`{id, invoice_id, amount (money), received_at (date), description, thankyou_invoice_email (datetime|null), created_at}`

### 14.5 DocumentActivity

`{id, type, date, description (Custom), amount (payment events)}`. The types are listed in §3.8.
Links to a DocumentEmail via `document_activity_id`.

### 14.6 DocumentEmail

`{id, type: NewInvoiceEmail | NewQuoteEmail | ReminderInvoiceEmail | ThankyouInvoiceEmail, to_email_address, cc_email_address, failed, document_activity_id}`

### 14.7 PresetLineItem (Settings → Inventory)

`{id, description (markdown), rate}`. Managed at `/settings/documents/inventory`:

- Page heading "Preset Line Items" with "Add a Preset Line Item".
- Intro text: "Save commonly used line items and add them to your Quotes & Invoices in a click."
- Empty state: "Your account doesn't have any preset line items."
- Doc 07 covers this page in full.

### 14.8 Account settings that affect documents (see doc 07)

| Setting | Effect |
|---|---|
| `payment_period` | Payment terms, default 7 days |
| `payment_details` | Invoice footer |
| `quote_footer` | Quote footer |
| Logo | Shown in the logo bar |
| Default taxes (≤ 2) | Added to new documents |
| `line_item_creation_options` | Builder defaults |
| `paypal_enabled`, `stripe_enabled` (and the plan's `*_feature`) | Online payments |
| `use_client_shortnames` | Prefix default for new clients |
| `billing_contact_name`, `business_name` | Email variables and the "From" block |

---

## 15. Permissions and plan gating *(from code)*

| Gate | Effect |
|---|---|
| `user.permissions.manage_invoices` | Registers the routes for **Quotes** and **Invoices** (including recurring). Without it the nav targets return 404 |
| `manage_invoices` **and** `view_financial_information` | Needed for Reports (doc 06) |
| `view_financial_information` | Needed for the Clients routes. The invoice builder lives under the client page |
| `account.paypal_feature` / `stripe_feature` (plan features) | Show the Payment Settings box and the provider checkboxes |
| `account.paypal_enabled` / `stripe_enabled` | Whether a checkbox can be turned on directly. If not, the setup modal opens |

---

## 16. Guided tours (onboarding) *(from code)*

Query param `?tour=` triggers guider overlays:

| Tour | Where | What it explains |
|---|---|---|
| `saved-invoice` | list | "Click on an invoice to view, manage, edit, and send it." |
| `send-demo-invoice` | edit | A demo client and invoice: add a logo and your business details, then "Send Invoice" to a Paydirt founder |
| `send-invoice` | show | Manage Mode vs Edit Mode, sending, payments, activity |
| `setup-payments` | show | Choose PayPal or Stripe |

Useful copy for our own onboarding:

- *"**Manage Mode** (this page) is where you can preview, print, download, and send your invoice.
  You can also manage payments and see the invoice's history. **Edit Mode** is where you can modify
  the invoice's business details, line items, taxes, and dates."*
- *"This button lets you send your invoice to your client with a link to view and pay the invoice
  online, and the invoice as a PDF attachment. Emails are generated automatically from custom
  templates, which can be edited before sending."*
