# Paydirt reference documentation

A full reference for **Paydirt** (app.paydirtapp.com), a time-tracking and invoicing app for
freelancers and small teams. It documents every page, function and design element, and is the
input for designing **paypure**, our own take on the product.

Captured: 2026-11-16, from a live, logged-in account (read-only: only GET requests were made, and
menus and forms were opened but never submitted).

## Contents

| # | Document | Covers |
|---|----------|--------|
| 01 | [Information architecture](01-information-architecture.md) | Global layout, sitemap/route table, navigation patterns, permissions, global behaviours |
| 02 | [Design system](02-design-system.md) | Colours, typography, spacing, component catalogue, icons, third-party UI libraries |
| 03 | [Clients, projects & tasks](03-clients-projects-tasks.md) | Clients list and detail, projects, tasks and rate types, expenses, keywords |
| 04 | [Time tracking](04-time-tracking.md) | Time log, logging and editing time, timers, tracker sidebar, timesheets |
| 05 | [Invoices & quotes](05-invoices-quotes.md) | Invoice and quote lifecycle, editor, payments, recurring invoices, client-facing view, PDF, emails |
| 06 | [Reports](06-reports.md) | Overview, time logged, project budgets |
| 07 | [Settings, account & team](07-settings-account-team.md) | Every settings page, plans, integrations, roles, email templates |
| 08 | [Data model & API](08-data-model-and-api.md) | Entities, relationships, enumerations, public REST API, internal endpoints |

## How this was produced

- **Server-rendered pages** (settings, account, API docs) were crawled with same-origin GET requests.
  Logout, delete, send, pay and other action links were excluded.
- **The app core** (reports, clients, time, quotes, invoices) is a Backbone/React single-page app.
  Each view was opened live in the browser and its rendered DOM was captured. Dropdowns, inline
  forms and panels were opened to record their contents.
- **Behaviour** not visible in the UI (status machines, permissions, templates) comes from the
  app's JavaScript bundle and is marked *(from code)*.
- **Privacy:** the captured account holds real client names, amounts and bank details, so the
  docs use placeholders (Acme Co, jane@example.com, $1,234.00). The raw capture and screenshots
  are kept **outside this repo**. Screenshot names such as `screenshots/16-invoice-edit.jpg`
  refer to that local capture.

## Known gaps

- Quotes and recurring invoices had no data in the account, so their list and detail screens were
  seen only in empty state. Their populated layouts are reconstructed from the app's templates.
- Actions that would change data (sending, recording payments, deleting, approving timesheets)
  were not performed. Their outcomes are documented from code.
- Marketing pages (pricing, features) are not covered beyond plan details shown inside the app.
