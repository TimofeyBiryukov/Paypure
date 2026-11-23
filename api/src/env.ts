import { z } from "zod";

/** Validated at boot; fails fast with a readable message (Tech §8). */
const Env = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  APP_DATABASE_URL: z.string().url().optional(),
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  CLIENT_INTERNAL_URL: z.string().url().default("http://client:3000"),
  GOTENBERG_URL: z.string().url().optional(),
  MAIL_TRANSPORT: z.enum(["log", "smtp"]).default("log"),
  SESSION_SECRET: z.string().min(8),
  PRINT_SIGNING_SECRET: z.string().min(8),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}
export const env = parsed.data;
