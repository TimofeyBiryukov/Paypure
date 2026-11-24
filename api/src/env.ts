import { z } from "zod";

/** Validated at boot; fails fast with a readable message (Tech §8). */
const Env = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  APP_DATABASE_URL: z.string().url().optional(),
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  /**
   * Client-facing invoice pages at PUBLIC_URL/i/<token>. Off by default: on a private
   * network (e.g. Tailscale) clients can't open the link, so emails leave it out.
   */
  PUBLIC_INVOICE_LINKS: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  CLIENT_INTERNAL_URL: z.string().url().default("http://client:3000"),
  GOTENBERG_URL: z.string().url().optional(),
  MAIL_TRANSPORT: z.enum(["log", "smtp"]).default("log"),
  /** smtp://host:port (STARTTLS when offered) or smtps://host:465 (TLS). Gmail: smtps://smtp.gmail.com:465 */
  SMTP_URL: z.string().url().default("smtp://mailpit:1025"),
  /** Kept out of SMTP_URL so an address with "@" and an app password need no URL-encoding. */
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Envelope/From address. Gmail only sends as the signed-in account (or a verified alias). */
  MAIL_FROM: z.string().email().optional(),
  /** Dev safety net: deliver every email here instead of to the client (original recipients go in X-Original-To). */
  MAIL_REDIRECT_TO: z.string().email().optional(),
  SESSION_SECRET: z.string().min(8),
  PRINT_SIGNING_SECRET: z.string().min(8),
});

// Compose passes unset optional vars as ""; treat them as unset.
const parsed = Env.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));
if (!parsed.success) {
  console.error("Invalid environment:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}
export const env = parsed.data;
