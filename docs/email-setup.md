# Sending invoices from your Gmail (local setup)

Paypure sends email over SMTP (nodemailer). For a personal Gmail account the simplest working
credential is an **App Password**: a 16-letter password Google generates for one app. It only
allows mail/IMAP-style access, you can revoke it at any time, and your real password never goes
into Paypure.

## 1. Create an App Password

1. Turn on **2-Step Verification** for the account (App Passwords don't exist without it):
   <https://myaccount.google.com/signinoptions/twosv>
2. Open <https://myaccount.google.com/apppasswords>, name it `Paypure local` and click
   **Create**.
3. Copy the 16 letters. Google shows them in groups (`abcd efgh ijkl mnop`); paste them with or
   without the spaces, both work. You won't see it again; if it's lost, delete it and make a new
   one.

If the App Passwords page says "not available": the account has no 2-Step Verification, uses
**Advanced Protection**, or is a Workspace account whose admin turned it off. Personal
`@gmail.com` accounts with 2SV always have it.

## 2. Put it in `.env`

In the repo root (`.env` is git-ignored):

```bash
cp .env.example .env
```

Then set these lines in `.env`:

```dotenv
MAIL_TRANSPORT=smtp
SMTP_URL=smtps://smtp.gmail.com:465
SMTP_USER=you@gmail.com
SMTP_PASS=abcdefghijklmnop
# While testing: send everything to yourself, not to the client
MAIL_REDIRECT_TO=you@gmail.com
```

`MAIL_FROM` is optional and defaults to `SMTP_USER`. Gmail rewrites any other From address to the
account's own, unless you've added it under Gmail → Settings → Accounts → **Send mail as**.

## 3. Restart the API and check

```bash
docker compose up -d api
```

```bash
docker compose logs api | grep -i smtp
```

You should see `SMTP ready: smtps://smtp.gmail.com:465 as you@gmail.com`. If you see
`SMTP check failed … 535 Username and Password not accepted`, the App Password is wrong or was
revoked (your normal Google password won't work here).

## 4. Send something

- **Settings → Business → Billing email** is the **Reply-To**, so client replies land there. Set
  it to your Gmail (or wherever you want replies).
- The display name on the From line is the business **sender name** (or business name).
- Send an invoice (or use the test send on an email template). The PDF is attached, and the
  email appears in your Gmail **Sent** folder too.
- With `MAIL_REDIRECT_TO` set, every email goes to that address only; the intended recipients
  are in the `X-Original-To` header. Remove the line and restart the API to send to clients.

Delivery status and errors show on the invoice's activity. A failed send is retried 5 times,
then marked failed (`last_error` on the `outbound_emails` row).

## Notes and limits

- **Sending limits:** a personal Gmail account can send roughly 500 messages a day. Fine for
  invoicing; not for bulk mail.
- **Deliverability:** mail goes out through Google's servers with Google's SPF/DKIM for
  `gmail.com`, so it lands well, as long as From is your Gmail address.
- **Revoke:** delete the App Password at <https://myaccount.google.com/apppasswords>. Changing
  your Google password also revokes all App Passwords.
- **Other providers** work the same way: set `SMTP_URL` (`smtps://host:465` for TLS, or
  `smtp://host:587` for STARTTLS), `SMTP_USER` and `SMTP_PASS`.
- **OAuth2 instead of an App Password** (Google Cloud project, consent screen, refresh token) is
  the route for a hosted, multi-user Paypure. It isn't needed for a local, single-account setup.
