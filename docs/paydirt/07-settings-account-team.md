# 07 — Settings, account & team

Settings are **classic server-rendered Rails pages** (full page loads and form POSTs with
`_method=patch`), not SPA views. Some sections mount small Backbone/React widgets after
`paydirt.initialized` fires. Each settings page is one or more `.box.settings` panels with a
`.title h2`. Fields use a two-column layout: `.option_label` on the left, `.option_field` on the
right, and grey `.field-desc` help text under the input. Fields are separated by `<hr>`, and a
`.submit-row` holds one primary submit button.

After a save the page redirects back and shows a flash message (`#flash`) *(standard Rails;
messages not captured)*.

## Settings navigation (left sidebar `#settings_navigation`)

Entry point: **Settings** link, top-right of the main bar (next to the log-out icon). It goes to
`/settings` (Profile).

| Heading | Item | Route | Section below |
|---|---|---|---|
| **Me** | Profile | `/settings` | [Profile](#profile-settings) |
| | Password | `/settings/password` | [Password & API key](#password--api-key-settingspassword) |
| **Account** | Preferences | `/settings/account` | [Preferences](#account-preferences-settingsaccount) |
| | Business Details | `/settings/account/business` | [Business details](#business-details-settingsaccountbusiness) |
| | Paydirt Plan | `/settings/account/plan` | [Plan & billing](#paydirt-plan--billing-settingsaccountplan) |
| | Integrations | `/settings/account/integrations` | [Integrations](#integrations-settingsaccountintegrations) |
| | Preset Tasks | `/settings/account/default_tasks` | [Preset tasks](#preset-tasks-settingsaccountdefault_tasks) |
| | Account Data | `/settings/account/data` | [Account data](#account-data-settingsaccountdata) |
| **Invoices & Quotes** | Defaults | `/settings/documents/defaults` | [Defaults](#quote--invoice-defaults-settingsdocumentsdefaults) |
| | Online Payments | `/settings/documents/payments` | *not captured*. See [05 › payments](05-invoices-quotes.md). |
| | Line Item Creation | `/settings/documents/line_items` | [Line item creation](#line-item-creation-settingsdocumentsline_items) |
| | Inventory | `/settings/documents/inventory` | [Inventory](#inventory--preset-line-items-settingsdocumentsinventory) |
| | Email Templates | `/settings/documents/email_templates` | [Email templates](#email-templates-settingsdocumentsemail_templates) |
| **Team** | Team Members | `/settings/team` (same page as `/users`) | [Team](#team-members-settingsteam--users) |
| | Invite Member | `/users/new` | [Invite](#invite-a-member-usersnew) |
| **Extensions** | Keywords | `/settings/extensions/keywords` | [Keywords](#keywords-settingsextensionskeywords) |

- Headings are non-clickable `li.heading`. The current page's item has `li.current`.
- The Plan page and Team page are **full-width** and have no sidebar.
- Account-level pages are presumably limited to users with `manage_account` *(unverified;
  captured as the Owner)*.

Screenshots: `screenshots/18-settings-profile.jpg` … `24-settings-integrations.jpg`.

---

## ME

### Profile (`/settings`)

Panel title **"Your Settings"**. Form `PATCH /settings` (`user[...]`).

| Label | Field | Type | Default / options | Help text |
|---|---|---|---|---|
| Your name | `user[name]` | text | — | "Your first name will do. This is just what we'll call you." |
| Your email | `user[email]` | text | — | "This is also your account login. We won't spam you or share your address." |
| Your avatar | `user[avatar]` | file. Hidden behind a **"Change my avatar"** link that reveals it. The current avatar shows above the link. | — | "A square image less than 200KB. We'll resize it for use in the app." |
| Time zone | `user[time_zone]` | select | Rails `ActiveSupport::TimeZone` list (~150 zones), labelled `(GMT±hh:mm) Name`, e.g. "(GMT-08:00) Pacific Time (US & Canada)", ordered by offset | — |
| Timesheets | (info only) | text | "You can enable Timesheet Approval from your [Account Settings](/settings/account) page." | — |
| Hourly rate | `user[hourly_rate]` | text (`form-6`), plain number e.g. `50.0` | — | "Your hourly rate, for tasks that are billed at user hourly rates." |
| — | `user[update_blocks]` | hidden | set by JS *(probably asks whether to re-price existing unbilled time when the rate changes; unverified)* | — |

Submit: **Save My Settings**.

User object fields seen in boot data: `name`, `email`, `archived`, `avatar_url` / `medium_avatar_url`,
`permissions{…}`, `installed_extension` (Chrome extension detected), `hourly_rate`,
`submits_timesheets`, `dismissed_notices{}`.

### Password & API key (`/settings/password`)

Two panels side by side.

**Left: "Change your password"**. Form `PATCH /settings/password`.

| Label | Field | Type |
|---|---|---|
| New password | `user[password]` | password |
| Confirm password | `user[password_confirmation]` | password |

Submit: **Update My Password**. No "current password" field.

**Right: "Your API Key"**. Description: "Used to access the [Paydirt API.](/documentation/api/introduction)".
A read-only-looking `<textarea>` holds the 32-hex-char key. There is no regenerate button.

---

## ACCOUNT

### Account Preferences (`/settings/account`)

Panel **"Account Preferences"**. Form `PATCH /settings/account` (`account[...]`).

| Label | Field | Type | Options / default | Help text |
|---|---|---|---|---|
| Primary currency | `account[currency_id]` | select | 53 currencies (list below). Default here: USD (id 1). | "You can choose a different currency for each client." |
| Default pricing | `account[default_price_type]` + `account[default_price]` (hidden, written by a React `PriceSelect` widget) | dropdown with explanations | See price types below. Captured default: `3` = Client rate, price `0.0`. | "How would you like to charge for your time?" |
| Email preferences | `account[weekly_summary_email]` | checkbox, default ✔ | **Weekly account summary** | "Keeps you up to date with your business's performance, and notifies you when it's time to invoice your clients." |
| | `account[forgotten_blocks_email]` | checkbox ✔ | **Timer left running** | "Receive an email reminder if a timer is left running for more than 12 hours." |
| | `account[invoice_overdue_notification_emails]` | checkbox ✔ | **Overdue invoice notifications** | "Receive an email notification if a client hasn't paid an invoice by its due date." |
| Week starts on | `account[first_day_of_week]` | select | Sunday(0) · **Monday(1)** · Tuesday(2) … Saturday(6) | — |
| Timesheets | `account[timesheet_approval]` | checkbox, default ☐ | **Enable timesheet approval for my account** | "You can select which [members of your team](/settings/team) are required to submit timesheets. They'll be emailed a reminder to submit their timesheet when the week ends." |

Submit: **Save Account Settings**.

Each checkbox is preceded by a hidden `value=0` input (the Rails pattern).

**There is no locale/language or date-format setting at account level.** Boot data carries a
`locales` list (Czech, Dansk, Deutsch, English, Español, Fārsi, Français, Magyar, Íslenska,
Italiano, Nederlands, Norsk, Polski, Português Brasileiro, Romanian, Svenska, Türkçe). It is used for
per-client document language (see 03/05). There is also no account-level time-rounding setting
here; rounding lives in **Line Item Creation**.

**Default pricing options (`PriceSelect`)**, in display order. Each option has a title and a small
explanation:

| Value | Title | Explanation | Extra input |
|---|---|---|---|
| 3 `CLIENT_HOURLY_RATE` | Client rate (or "Client rate ($X /hr)" in client context) | Time logged is billable at **this client's hourly rate**. | — |
| 5 `PROJECT_HOURLY_RATE` | Project rate | Time logged is billable at **this project's hourly rate**. | — |
| 0 `PER_HOUR` | Custom hourly rate (shown as "Per hour" when selected) | Time logged is billable at **the hourly rate you choose** for this particular task. | price input |
| 2 `PER_USER` | User hourly rate | Time logged is billable at each **user's own hourly rate**. | — |
| 1 `FIXED_PRICE` | Fixed price | A **fixed dollar amount** for the task, regardless of the amount of time logged. Time logged is **not billable**. | price input |
| 4 `NOT_BILLABLE` | Not billable | Time logged is **not billable**. | — |

**Currencies (name, code, sign):** Argentina Pesos ARS $ · Australian Dollars AUD $ · Bahraini
Dinars BHD BD · Bitcoin BTC Ƀ · Brazilian real BRL R$ · Bulgarian lev BGN лв · Canadian Dollars CAD $ ·
Cayman Islands Dollars KYD $ · Chilean Pesos CLP $ · Chinese Yuan Renminbi CNY ¥ · Colombian Pesos
COP $ · Czech koruna CZK Kč · Danish Kroner DKK kr. · Egyptian Pounds EGP E£ · Euro EUR € · Fijian
Dollars FJD $ · Ghanaian cedi GHS GH₵ · Hong Kong Dollars HKD $ · Hungarian Forint HUF Ft · Icelandic
króna ISK kr. · Indian Rupees INR ₹ · Indonesian Rupiah IDR Rp · Iranian Rial IRR ریال · Israeli New
Shekel ILS ₪ · Japanese Yen JPY ¥ · Kenyan Shilling KES KSh · Lebanese Pounds LBP ل.ل · Lithuanian
Litas LTL Lt · Malaysian Ringgit MYR RM · Mexican Pesos MXN $ · Moroccan dirham MAD MAD ·
Netherlands Antillean Guilders ANG NAf · New Zealand Dollars NZD $ · Nigerian Naira NGN ₦ ·
Norwegian Kroner NOK kr · Pakistani Rupees PKR Rs · Phillipines Pesos PHP ₱ · Polish Złoty PLN zł ·
Romanian leu RON lei · Russian Rubles RUB руб · Singapore Dollars SGD S$ · South Africa Rand ZAR R ·
South Korean Won KRW ₩ · Swedish Kronor SEK kr · Switzerland Francs CHF Fr. · Thai Baht THB ฿ ·
Turkish lira TRY ₺ · Ukranian Hryvni UAH ₴ · Unidad de Fomento UF $ · United Arab Emirates dirham
AED د.إ · United Kingdom Pounds GBP £ · United States Dollars USD $ · Venezuelan Bolívares Fuertes
VEF Bs. (Sorted alphabetically by name; the source typos "Phillipines" and "Ukranian" are kept as
seen.)

Screenshot: `screenshots/19-settings-account-preferences.jpg`.

### Business Details (`/settings/account/business`)

Panel **"Your Business Details"**. Form `PATCH /settings/account/business`.

| Label | Field | Type | Help text |
|---|---|---|---|
| Business name | `account[business_name]` | text | — (e.g. "Acme Co") |
| Contact name | `account[billing_contact_name]` | text | "This appears on quotes and invoices. Use your full name." |
| Billing email | `account[billing_email_address]` | text | "The email address used to send quotes and invoices to your clients." Plus a note box: "If possible, your quotes and invoices will be sent to your client **from** this email address." and a link **"Click here to check whether we can send 'from' this address"**. |
| Business address | `account[billing_address]` | textarea (multi-line, free text: address, phone, email) | "This address is displayed on your quotes and invoices." |

Submit: **Save Business Details**.

**SPF check *(from code)*:** the link POSTs `/settings/check_spf {email_address}` and shows
"⟳ Checking jane@example.com" in `#spf-check-results`. That box is then replaced by server HTML
saying whether Paydirt may send as that domain. If not, mail goes out from Paydirt's own address
*(inferred)*.

Note: the **logo** is not here. It is on Invoices & Quotes › Defaults.

### Paydirt Plan & billing (`/settings/account/plan`)

Full-width pricing page (no sidebar). The same page is shown at **`/users/new` when the plan has no
free seats**, with the flash warning *"You need to upgrade your plan before you can add another user
to your account"*.

**Top controls**

| Control | Detail |
|---|---|
| Billing period toggle | Radio pair `annual`: **Monthly billing** (default) / **Annual billing (save 15%)**. Switching shows/hides `.monthly-plans` / `.annual-plans` client-side. |
| Coupon | Text "Enter your coupon code here" + button **Apply coupon** → `POST /settings/apply_coupon {coupon_code}`. Each plan form also carries a hidden `coupon_code`. |

**Plan cards** (6 regular cards plus an Enterprise toggle). Each card shows the name, price,
a feature list, and a CTA. The CTA is a form `POST /stripe/change_plan {plan_unique_id, coupon_code}`.

| Plan | Monthly | Annual | Seats | Clients | Online payments | User permissions | Timesheet approval | Task assignment | Plan id |
|---|---|---|---|---|---|---|---|---|---|
| **Agency** | $149 | $1,490 | 20 team members (ⓘ "Need more than 20 team members? Check out our Enterprise plan…") | Unlimited | ✔ | ✔ | ✔ | ✔ | `agency_usd` / `agency_annual_usd` |
| **Large Team** | $79 | $790 | 10 | Unlimited | ✔ | ✔ | ✔ | ✔ | `large_team_usd` |
| **Small Team** | $49 | $490 | 6 | Unlimited | ✔ | ✔ | ✔ | ✔ | `small_team_usd` |
| **Co-op** | $29 | $290 | 3 | Unlimited | ✔ | ✔ | ✔ | ✔ | `coop_usd` |
| **Hustler** | $16 | $160 | Single user | Unlimited | ✔ | — | — | — | `hustler_usd` |
| **Starter** | $8 | $80 | Single user | **3 active clients** (ⓘ "You can archive old clients to make room for new ones") | — | — | — | — | `starter_usd` |
| **Enterprise** (behind link "← We also have an Enterprise plan for larger teams") | $249 | $2,490 | "Comes with 40 users", "Can add additional users" (**$5/user/month or $50/user/year**) | Unlimited | ✔ | ✔ | ✔ | ✔ | `enterprise_usd` |

Tooltips: Online payments: "Your invoices can be paid online via PayPal and Stripe". User
permissions: "Configure the features and information each team member has access to".

Enterprise aside text: "Paydirt offers the Enterprise plan for large teams. It comes with 40
users, and additional users can be added for $5 each per month (or $50 per year.) Naturally, it
includes every feature Paydirt offers, advanced user permissions, and top-tier support. If you
have any questions… email talk@paydirtapp.com". A "back to regular plans →" link returns.

**CTA states per card**

| Situation | CTA |
|---|---|
| Your current plan (current period) | Badge "✔ **Your current plan**" (no button) |
| Same plan, other billing period | Button **Annual Billing** (or Monthly) |
| Any other available plan | Button **Upgrade Plan** (the label reads "Upgrade" even for downgrades) |
| Plan not allowed by usage | Disabled **Sign up** with tooltip, e.g. "This plan isn't available because you already have N active clients" |

**Plan gating flags** (boot data `account.features`): `paypal`, `stripe` (online payments),
`extra_users` (multi-user), `assignment` (task assignment). `allowed_clients` is `null` (unlimited)
or a number (Starter: 3). *(From code:)* `features.extra_users` shows "Add people to your team"
links; `features.assignment` enables task assign/unassign menus.

**Below the cards**

- Banner: "ⓘ All plans come with UNLIMITED projects, tasks, time tracking, invoices and quotes."
- Info: "You can **update your billing details at any time**." This link opens Stripe Checkout
  (`checkout.stripe.com/checkout.js` is loaded, along with the publishable key, Paydirt icon and the
  user's email) to replace the card *(inferred)*. Followed by "You can also **view your payment receipts**."
  (→ `/stripe/receipts`).
- Three testimonial quotes with avatars.
- **"Frequently asked questions"** box, six Q&As: How does billing work? (every 30 days monthly or
  every 12 months annual; via Stripe) · Do I get a discount if I pay annually? (15%) · What if
  I'm unhappy? (full refund) · Am I on a contract? (no, cancel any time, no setup or cancellation fee) ·
  Do you have an affiliate system? (no) · I have another question… (email).

#### Receipts (`/stripe/receipts`, modal)

Modal **"Your Payment Receipts"**: a list of lines like "$16 USD on <date>", each with
**View** (`/stripe/receipt/<invoice_id>`) | **Download PDF** (`…/<invoice_id>.pdf`). Newest first,
no pagination.

**Receipt page** (`/stripe/receipt/:id`, bare layout, modal box): title "Invoice in_…". **Recipient**:
business name and business address (from Business Details). A table with Description ("Subscription
to Paydirt's <Plan> plan from <start> to <end>") / Price, **Total**, **Paid**.
Footer: Paydirt's own legal entity, website, address, ABN/ACN, and a contact email.

#### Cancel subscription / churn survey

Reached from **Account Data › Cancel my subscription**, which links to `/stripe/churn_survey`.
The page also embeds Baremetrics "Barecancel" with the Stripe subscription id, so the cancel click
may be intercepted by Barecancel's own retention flow *(from page script)*.

Modal **"Got a second to help us out?"**. Form `POST /stripe/cancel_subscription`.

- Text: "We'd really love to know why you're canceling your subscription."
- `churn_info[reason]` select (blank first):

| Value | Label | Follow-up field shown (`churn_info[extra_info]`) |
|---|---|---|
| `bad_experience` | I had a bad experience using Paydirt | text: "Sorry to hear that. How can we do better in future?" |
| `switched_to_competitor` | I've switched to another product | text: "Do you mind telling us which product you switched to?" |
| `missing_feature` | Paydirt was missing a feature I needed | text: "Sorry to hear that. What features did you need?" |
| `not_needed_currently` | I don't need to track time or send invoices any more | select Yes/No: "Do you think you'll need Paydirt again in the future?" |
| `too_expensive` | My plan was too expensive | *(no follow-up seen; unverified)* |
| `other` | Other... | textarea placeholder "Why are you canceling your subscription?" |

  Only the follow-up matching the reason is enabled and shown. The rest are disabled so that only one
  `extra_info` is posted.
- Actions: **I've changed my mind** (closes the modal) · **Cancel my subscription** (submit).
- Effect (from the Account Data copy): the account goes **read-only at the end of the current
  billing period**. There are no further charges, and the user can resubscribe later.

### Integrations (`/settings/account/integrations`)

A 2×2 grid of integration cards. Each has a logo (`.integration-name`), a description, and a
mechanics area that switches between *not connected*, *connecting* (spinner "Connecting to …") and
*connected*. The connected state is driven by `account.trello_connected`, `basecamp_connected` and
`redbooth_connected`.

| Integration | Description | Not connected | Connected |
|---|---|---|---|
| **Trello** | "Our Trello integration allows you to import Trello boards as projects in Paydirt, and track time towards each card." | **Connect to Trello** → `/integrations/trello/connect` (OAuth 1 authorise screen on trello.com, read-only scopes: name/username, enterprises, boards & workspaces, power-ups) | "✔ Paydirt is linked to your Trello account". "To import a project from Trello, go to a client's page in Paydirt and select "Create from Trello Board" under the "New project" button." Button **Import my team from Trello**. Small link **Disconnect from Trello** (`DELETE /integrations/trello/disconnect`). |
| **Basecamp** | "…import Basecamp 2 and Basecamp 3 projects into Paydirt, and track time towards each To-Do." | **Connect to Basecamp** | Same pattern: "Create from Basecamp Project", **Import my team from Basecamp**, **Disconnect from Basecamp** |
| **Redbooth** | "…import Redbooth projects into Paydirt, and track time towards each task." | **Connect to Redbooth** | Same pattern: "Create from Redbooth Project", **Import my team from Redbooth**, **Disconnect from Redbooth** |
| **Zapier** | "Our Zapier integration allows you to sync data between Paydirt and any of the 750+ other apps available on Zapier." | **Install Paydirt at Zapier** (external invite link) | — |

Project import *(from code)*: from a client page, New project ▾ → "Create from … " opens a modal
that fetches `/integrations/{svc}/fetch_open_boards|fetch_current_projects` and posts to
`create_project_from_{board|basecamp_project|redbooth_project}`. Cards, to-dos and tasks become
Paydirt tasks.

**Import your team** modal (`/integrations/{trello|basecamp|redbooth}/import_people`). Form
`POST /users/import`.

- Intro: "Select the team members that you would like to add to your Paydirt account. We'll send
  the selected team members an email to invite them to your account." and "You can determine what each
  team member will have access to by making them an Admin, Employee, or Contractor."
- Plan warning (info box): "Your plan includes N users. If you want to add more than N users,
  you'll need to [upgrade your account]."
- Table `#import-users`: header row "Select all / Select none". One row per remote person:
  checkbox `import` (default ✔, row highlighted `.selected`), hidden remote ids, avatar, **Name**
  (prefilled), **Email address** (empty, since Trello doesn't expose emails), **Role** select
  (Admin / **Employee** default / Contractor), **Rate** (prefilled with the inviter's rate,
  e.g. `$50`) "/ hour". Unchecking a row skips validation for it.
- Empty state: "It looks like you don't have anyone to import. [Add a team member] or [close
  this popup]."
- Actions: **cancel** · **Import my team**.

Screenshot: `screenshots/24-settings-integrations.jpg`.

### Preset Tasks (`/settings/account/default_tasks`)

React `DefaultJobGroupList` (model `DefaultJobGroup` → `/default_job_groups`, with child
`DefaultJob`s).

- Header link **Add Task Group** (right) + `h2` **Preset Tasks**.
- Info well: "You can quickly add commonly used tasks to your clients by defining them as presets.
  Task groups can be imported as a new project, or have their tasks imported into existing
  projects."
- **Task group** card: `h2` group name. **Add Task** link and a ⋯ dropdown with ✎ **Edit** and
  ⊗ **Delete**.
  - Edit form: text "Group name" (autofocus) · **Save** or *cancel*. Cancelling a new group
    removes it.
  - Delete confirm modal: "Deleting this task group will also remove all the preset tasks it
    contains. This won't affect projects that had these tasks added to them. Are you sure you want
    to do that?" with buttons **No, don't delete it** / **Yes, delete preset task group**.
- **Preset task** row:
  - Show: `h3` task name. If any users are assigned, "👤 Assigned *Name, Name*". A price pill
    (e.g. "Client rate", "$80 /hr", "Fixed $500"). A ⋯ menu with **Edit**, **Assign User**,
    **Unassign User** and **Delete** (assign/unassign open an assignment-manager modal).
  - Edit: text "Task Name" (autofocus) + the `PriceSelect` (same 6 price types as above) ·
    **Save** (disabled while the name is blank) or *cancel*.
- Empty state: just the header and info (no groups).
- Use *(from code)*: on a client page, "New project ▾ › from preset tasks" opens
  `/default_job_groups/import_project?client_id=…` as a modal, which creates a project from a group.
  Tasks can also be imported into an existing project (`#import-default-jobs` form).

### Account Data (`/settings/account/data`)

**Panel 1: "Export Account Data"**. "Paydirt makes it easy to export your account data at any
time. As soon as your data finishes exporting, it will be emailed to you."

| Button | Route | Output |
|---|---|---|
| Export your time logs (CSV) | `/export/time` | CSV, emailed |
| Export your invoices (ZIP) | `/export/invoices` | ZIP (of PDFs, presumably), emailed |
| Export your quotes (ZIP) | `/export/quotes` | ZIP, emailed |

These are remote (AJAX) links. On click the button gets `no-click`, and "You will receive this data
by email shortly." appears next to it. On success a flash notice shows. There is **no import**
function anywhere in settings, except importing people and projects from integrations.

**Panel 2: "Cancel Your Paid Subscription"**. "Canceling your subscription will put your account
into read-only mode at the end of your current billing period. You won't be billed again, unless
you choose to start a subscription again in the future. You can come back at any point in time."
Button **Cancel my subscription** opens the [churn survey](#cancel-subscription--churn-survey).

There is no "delete account" option.

---

## INVOICES & QUOTES

### Quote & Invoice defaults (`/settings/documents/defaults`)

Panel **"Quote & Invoice defaults"**. Form `PATCH /settings/documents/defaults`.

| Label | Field | Type | Default | Help text |
|---|---|---|---|---|
| Payment terms | `account[payment_period]` | small number input, followed by "days" | e.g. `7` | "You can override this default on any invoice." |
| Invoice footer | `account[payment_details]` | textarea | free text, e.g. "Please pay by bank transfer to: Bank name, Account no. XXXX, SWIFT XXXX" | "Included on the bottom of your invoices. You might include your bank account details or other payment preferences." |
| Quote footer | `account[quote_footer]` | textarea | empty | "Included on the bottom of your quotes. You might include your terms and conditions or other fine print." |
| Logo | `account[logo]` | file | — | "Maximum logo width: 769px, height: 300px. Larger images will be resized." |

Submit: **Save Settings**. This saves the panel above only; taxes save independently.

**Panel 2: "Default Taxes"** (Backbone `Taxes.Index`, AJAX CRUD per row):

- Title link **Add a Default Tax**. Description: "These taxes are automatically applied to new quotes
  and invoices. You can have up to 2 default taxes."
- Columns **Name** | **Percentage** | (actions: ✎ Edit, × Delete).
- Inline form: `Name` (required) · `Percentage` (e.g. "10%", parsed by `percentageToNumber`) ·
  **Cancel** or **Save**.
- **Limit 2**: the "Add" link is hidden once 2 taxes exist.
- Empty: "Your account doesn't have any default taxes."
- Defaults apply to **new** documents only *(inferred)*.

Screenshot: `screenshots/20-settings-quote-invoice-defaults.jpg`.

### Line Item Creation (`/settings/documents/line_items`)

Panel **"Line Item Creation"**. Info: "These are default settings that may be overridden on each
invoice." These settings control how billable time is converted to invoice line items when you
create an invoice from logged time. Form `PATCH /settings/documents/line_items`. Submit: **Save
Line Item Settings**.

| Group | Control | Field | Options / default (captured) |
|---|---|---|---|
| **Time rounding** | "How should each log entry to be rounded for invoices created from billable time that you've logged?" select | `account[line_item_rounding_type]` | `0` **No rounding** (default) · `1` Round to nearest · `2` Round up to |
| | minutes input (hidden when No rounding) | `account[line_item_rounding_value]` | default `5`, followed by "minutes" |
| **Invoice description** | ☐ Include total number of hours | `include_total_hours_in_invoice_description` | off |
| | ☐ Include project name(s) | `include_project_names_in_invoice_description` | off |
| **Converting logged time to line items** | ◉ Create one line item for each log entry | `any_grouping=false` | default |
| | ○ Group log entries together into line items, which reveals: | `any_grouping=true` | |
| | ↳ ☐ Group by time period: [day ▾ / week / month] | `group_line_items_by_date` = 0/1/2, or empty = no date grouping | select is disabled unless the box is ticked |
| | ↳ ☐ Group by task | `group_line_items_by_job` | off |
| **Line item descriptions** | ☑ Include project name | `include_project_names_in_line_item_descriptions` | on |
| | ☑ Include task name | `include_job_names_in_line_item_descriptions` | on |
| | ☑ Include billable time log descriptions | `include_block_descriptions_in_line_item_descriptions` | on |

Rounding is applied **per log entry** before line items are built. Grouping by date and by task can
be combined (e.g. one line per task per week).

Screenshot: `screenshots/22-settings-line-item-creation.jpg`.

### Inventory = Preset Line Items (`/settings/documents/inventory`)

Backbone `PresetLineItems.Index`.

- Title **Preset Line Items** with link **Add a Preset Line Item**.
- Info: "Save commonly used line items and add them to your Quotes & Invoices in a click."
- Columns **Description** | **Unit Price** | actions (✎ edit, × delete).
- Inline form: `Description` textarea (autogrow, **Markdown**, rendered with `marked` and sanitised) ·
  `Unit Price` (right-aligned, currency format without sign) · **Cancel** or **Save** → flash.
- Empty: "Your account doesn't have any preset line items."
- No quantity, tax or currency per preset. The price is a bare number interpreted in the
  document's currency.
- Used from the invoice/quote editor's line-item menu (see 05).

### Email Templates (`/settings/documents/email_templates`)

One form `PATCH /settings/documents/email_templates` contains four template blocks (Backbone
`Settings.InvoiceEmail`). Submit (bottom, shown after JS init): **Save Email Templates**.

Each block has:

- Header `h2` title + a toggle **👁 Preview** (default) | **✎ Edit**.
- **Preview** mode: Subject and Body (`pre`), with placeholders interpolated using **sample data**:
  client "The Bluth Company" / "Michael Bluth" / "Michael", number "blu-001", due date = today − 6
  days, days overdue 6, totals 2,450 and payment 1,450 in the account currency, invoice description
  "Monthly land surveying fee for October", quote description "Land surveying for Swing City", and
  your real business and contact name. Empty values render as `[name is missing]`. Template errors
  render as "One of the email variables is wrong: …".
- **Edit** mode: `Subject` text input (`account[<id>_subject]`) and `Body` textarea, 6 rows
  (`account[<id>_body]`). Next to them, info text: "Email tags are automatically substituted when
  you compose an email. Select a tag to be inserted at the current cursor positon." and a select2
  **"Select a tag to insert..."** that inserts the tag at the last caret position in whichever field
  last had focus (the body by default) and then resets.

| # | Title | id | Default subject | Default body |
|---|---|---|---|---|
| 1 | Sending a quote | `quote_email` | `New quote {{ quote_number }} from {{ our_contact_name }}` | Hello {{ client_contact_name }},⏎⏎Please find attached quote {{ quote_number }}.⏎⏎Regards,⏎{{ our_contact_name }} |
| 2 | Sending an invoice | `invoice_email` | `New invoice {{ invoice_number }} from {{ our_contact_name }}` | Hello {{ client_contact_name }},⏎⏎Please find attached invoice {{ invoice_number }}, due {{ invoice_due_date }}.⏎⏎Regards,⏎{{ our_contact_name }} |
| 3 | Overdue invoice reminder | `invoice_reminder_email` | `Overdue invoice {{ invoice_number }} from {{ our_business_name }}` | Hello {{ client_contact_name }},⏎⏎Please find attached invoice {{ invoice_number }}, which was due on {{ invoice_due_date }}.⏎⏎This invoice is now {{ invoice_days_overdue }} days overdue. We would appreciate your prompt attention to this matter.⏎⏎Regards,⏎{{ our_contact_name }} |
| 4 | Thanks for your payment | `invoice_thankyou_email` | `Thanks for your payment of invoice {{ invoice_number }} from {{ our_contact_name }}` | Hello {{ client_contact_name }},⏎⏎Thanks, your payment of {{ invoice_payment_amount }} for invoice {{ invoice_number }} has been received.⏎⏎Regards,⏎{{ our_contact_name }} |

**Placeholder tags** (the tag picker list depends on the template):

| Tag | Meaning (picker label) | Available in |
|---|---|---|
| `{{ client_business_name }}` | The client's business name | all |
| `{{ client_contact_name }}` | The client's full name | all |
| `{{ client_contact_first_name }}` | The client's first name | all |
| `{{ our_business_name }}` | Your business name | all |
| `{{ our_contact_name }}` | Your business billing contact name | all |
| `{{ invoice_number }}` | The unique invoice number | invoice templates (2–4) |
| `{{ invoice_due_date }}` | The due date of the invoice | 2–4 |
| `{{ invoice_total }}` | The invoice's total price | 2–4 |
| `{{ invoice_description }}` | The invoice description | 2–4 |
| `{{ invoice_days_overdue }}` | The number of days since the invoice was due | 3 only |
| `{{ invoice_payment_amount }}` | The payment amount | 4 only |
| `{{ quote_number }}` | The unique quote number | 1 |
| `{{ quote_total }}` | The quote's total price | 1 |
| `{{ quote_description }}` | The quote description | 1 |

Syntax is Mustache-like `{{ tag }}` (interpolated with underscore's `_.template` using the regex
`\{\{(.+?)\}\}`). There is no conditional or loop logic and no HTML. Bodies are plain text. These are
defaults; the actual send dialog lets the user edit the text per email (see 05). Templates are
account-wide, with no per-client or per-language variants.

Screenshot: `screenshots/21-settings-email-templates.jpg`.

### Online Payments (`/settings/documents/payments`)

Not captured. From other evidence: PayPal and Stripe can be connected
(`account.paypal_enabled`, `stripe_connected`, `stripe_enabled`, gated by `features.paypal` and
`features.stripe`). See 05.

---

## TEAM

### Team Members (`/settings/team` ≡ `/users`)

Full-width page (no settings sidebar).

**Page head:** `h1` "Your team". On the right, a seat-accounting table:

| | | |
|---|---|---|
| [Your plan] (tooltip "You're on the <Plan> plan") comes with | **1 user** | [upgrade/downgrade](/settings/account/plan) |
| You currently have | **1 active user** | (0 available seats) |

**Page links:** split button **Add a team member** (→ `/users/new`) with a ▾ dropdown:

- Quick-add your team (`/users/invite_multiple`, modal)
- Import team from Trello (`/integrations/trello/import_people`, modal)
- Import team from Basecamp (→ integrations page)
- Import team from Redbooth (→ integrations page)

URL hashes `#invite_multiple`, `#import_from_basecamp` and `#import_from_trello` auto-open the
matching modal.

**Body:** "Current Team Members" grid of **user cards**, followed by a dashed **"⊕ add a new team
member"** card.

| Card element | Detail |
|---|---|
| Ribbon | "Owner" (corner ribbon) for the account owner. Presumably also shows roles or "Invited" for pending users *(unverified)*. |
| Avatar | medium |
| Name | `h3` |
| Email | grey |
| Permissions button | "**Admin Permissions** ▾" (role name + "Permissions"). Its dropdown lists the 5 permissions with ✔ for granted ones (the toggle is `data-action=toggle-user-permissions`). |
| Footer link | Own card: "✎ Edit My Settings" (→ `/settings`). Other users: an Edit link to `/users/:id/edit` *(unverified)*. |

The team list was captured with only the owner, so archived users, deactivate/remove actions and
pending-invite states were not seen.

Screenshot: `screenshots/23-settings-team.jpg`.

### Roles & permissions

Five boolean permissions per user (`user.permissions`). The client-side checks are `Paydirt.user.can*()`
in `app.js`:

| Permission key | UI label | Method | What it gates *(from code)* |
|---|---|---|---|
| `manage_account` | Manage account | `canManageAccount()` | Settings/account pages *(server)*. **Submitted Timesheets** tab and routes (`timesheets/submitted*`, only if `timesheet_approval` is on). "Add people to your team" link in the time form (with `features.extra_users`). |
| `manage_invoices` | Manage invoices | `canManageInvoices()` | **Quotes & Invoices** routes (`quotes*`, `invoices*`, `recurring_invoices*`). New quote/invoice actions on the client page. Part of **Reports** access. |
| `view_financial_information` | View financial information | `canViewFinancialInformation()` | **Clients** routes (`clients*`). Hourly rate fields and money values in the time log and tracker (otherwise shows billable status without amounts). Billable-status filter. The billable summary column on the time log. Part of **Reports** access. **Reports** routes need `view_financial_information` **AND** `manage_invoices`. |
| `view_all_time_logged` | View all time logged | `canViewAllTimeLogged()` | **Running Timers** tab and route (`time/running`). "Filter by team member" in the time log. The team-member picker when logging time (log on behalf of others). CSV/report links on the time log. |
| `log_time_without_assignment` | Log time without assignment | `canLogTimeWithoutAssignment()` | The tracker's job search can show all tasks rather than only assigned ones (the "only assigned" toggle). Otherwise users can only track to tasks they're assigned to. |

Always available: `time`, `time/log`, `time/:id/edit|duplicate`, `timesheets` (My Timesheets tab
only if `user.submits_timesheets`), and the 404 route.

Dependencies *(from code, `Settings.UserPermissions`)*: ticking **Manage invoices** auto-ticks
**View financial information**. Unticking **View financial information** auto-unticks **Manage
invoices**.

**Roles** are named presets of the 5 permissions: **Admin**, **Employee**, **Contractor**. In the
user edit form, radio `user_role` options carry a `data-permissions` JSON. Picking a preset sets
the checkboxes and collapses the permission panel. Picking a role without presets (a custom role)
slides the 5 checkboxes open for manual choice *(from code; the form itself was not captured)*. Each
row is a clickable `.user-permission-select` tile.

| Role | Permissions |
|---|---|
| Admin (and Owner) | all 5 ✔ (verified on the owner card) |
| Employee | *(unverified)*. Likely time-focused: no manage account/invoices or financial info. Probably no view-all-time. |
| Contractor | *(unverified)*. Likely the most restricted, e.g. without `log_time_without_assignment`. |

Other per-user settings: `hourly_rate` (used by the "User hourly rate" price type) and
`submits_timesheets` (required to submit weekly timesheets when approval is on; set per member
from the team list or user edit, *unverified UI*).

### Invite a member (`/users/new`)

If seats are available: a single-user invite form *(not captured; based on the multi-invite row it
presumably has Name, Email, Role, Hourly rate, and permissions)*. An email invitation is sent.

If **no free seats** (as captured on a single-user plan): `/users/new` renders the **plan page** with
flash "You need to upgrade your plan before you can add another user to your account".

### Quick-add your team (`/users/invite_multiple`, modal)

Modal **"Quick-add your team"**. Form `POST /users/invite_multiple`.

- Text: "We'll send each team member an email to invite them to your account." and "You can
  determine what each team member will have access to by making them an Admin, Employee, or
  Contractor."
- Rows (`users/invite_row`), starting with one row (that row cannot be removed):

| Field | Type | Default | Validation |
|---|---|---|---|
| Full name | text `users[attributes][<ts>][name]` | — | required |
| Email address | text `…[email]` | — | required |
| Role | select | Admin / **Employee** / Contractor | — |
| Rate | currency input `…[hourly_rate]`, followed by "/ hour" | the inviter's own hourly rate | — |
| × | remove row | (absent on the first row) | — |

- Link **+ Add another team member** appends a row.
- Actions: **cancel** · **Invite my team** (button with an arrow).

---

## EXTENSIONS

### Keywords (`/settings/extensions/keywords`)

Keywords ("work signals") belong to the **Paydirt Chrome Extension**. It scans the pages you
browse and, when it finds a client's keyword, prompts you to start a timer for that client.

- Info box: "The Paydirt Chrome Extension searches for keywords to determine who you're working
  for, and will prompt you to start a timer for the matching client when it detects these keywords
  on the page. See how it works in this short video, and take a look at our recommended keywords."
- **Recommended keywords** (expandable list, hover tooltips):
  - Web addresses: `example.com` (matches every page at a domain), `example.com/wp-admin/` (only
    pages under the path), `twitter.com/acme` (client's Twitter), `localhost/acme/` (development URLs
    work great).
  - Business names, e.g. "Acme Co".
  - People's names, e.g. "Jane Client".
  - Email addresses: `jane@example.com` (full address), `@example.com` (any address at a domain).
- Then **one box per client** (loaded from `GET /work_signals` → `{clients, work_signals}`):
  - Title `h2` = client business name, with link **Add a keyword**.
  - Rows: keyword text · "**Test this keyword**" (opens a Google search for it, only shown when
    `user.installed_extension`; otherwise "Install the Paydirt extension for Chrome to use
    keywords") · ✎ edit · × delete.
  - Inline form: single text input · **Cancel** or **Save** → flash.
  - Empty: "No keywords means no notifications! You should **add your first keyword** for Acme
    Co."
- The same widget appears per client at `/clients/:id/keywords` (see 03).

---

## Notes for our version

- Settings are split across ~15 pages with three different UI technologies, and saves are
  per-panel, so it's easy to miss that the taxes, presets and keyword lists autosave while the
  forms beside them don't. Prefer one consistent pattern, either everything autosaves or explicit save.
- Business identity is scattered: the logo is under Invoices › Defaults, the address under Business
  Details, and bank details sit in an "Invoice footer" free-text box. Use structured fields (tax ID,
  bank details, address lines) and a single **Branding** page with a live document preview.
- Roles are only three opaque presets of 5 flags, and the matrix isn't visible before inviting.
  Show the role-to-permission matrix inline, and consider per-client or per-project access.
- Email templates are plain text with only a few tags and no per-client or per-language variants
  (even though clients do have a document locale). Add locale variants, a reminder schedule
  (overdue reminders here are a single template), and a real "send test email" action.
- There's no account deletion, no data import (CSV of clients/time), and exports are only via email.
  Offer direct downloads and a JSON export.
