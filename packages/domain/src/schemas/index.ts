import { z } from "zod";
import { isCurrency } from "../currency";
import { isCalendarDate } from "../time";

/** The API contract (Tech §3): request bodies validated in the API, typed in the client. */

export const MoneySchema = z.object({ minor: z.number().int(), currency: z.string().length(3) });

const id = z.string().uuid();
const minor = z.number().int().min(0).max(2147483647);
const date = z.string().refine(isCalendarDate, "Use YYYY-MM-DD");
const currency = z.string().refine(isCurrency, "Unsupported currency");
const optText = z.string().max(5000).optional();

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tz: z.string().optional(),
});

export const ClientInput = z.object({
  name: z.string().trim().min(1).max(200),
  contactName: z.string().max(200).optional(),
  billingEmails: z.array(z.string().email()).max(10).optional(),
  address: optText,
  taxId: z.string().max(100).optional(),
  currency: currency.optional(),
  rateMinor: minor.nullable().optional(),
  termsDays: z.number().int().min(0).max(365).nullable().optional(),
  colour: z.number().int().min(0).max(9).optional(),
  notes: optText,
  defaultPaymentAccountId: id.nullable().optional(),
});
export type ClientInput = z.infer<typeof ClientInput>;

export const ProjectInput = z.object({
  clientId: id.optional(),
  name: z.string().trim().min(1).max(200),
  rateMinor: minor.nullable().optional(),
  budgetKind: z.enum(["hours", "money"]).nullable().optional(),
  budgetValue: z.number().int().min(0).nullable().optional(),
  status: z.enum(["active", "completed"]).optional(),
  notes: optText,
});
export type ProjectInput = z.infer<typeof ProjectInput>;

export const TaskInput = z.object({
  projectId: id.optional(),
  name: z.string().trim().min(1).max(200),
  billingMode: z.enum(["hourly", "fixed", "non_billable"]).optional(),
  rateMinor: minor.nullable().optional(),
  fixedAmountMinor: minor.nullable().optional(),
  estimateSeconds: z.number().int().min(0).nullable().optional(),
  done: z.boolean().optional(),
});
export type TaskInput = z.infer<typeof TaskInput>;

export const TimerStartInput = z.object({
  taskId: id.nullable().optional(),
  note: z.string().max(5000).optional(),
  offsetSeconds: z.number().int().min(0).max(86400).optional(),
  afterLastEntry: z.boolean().optional(),
  tz: z.string().optional(),
});

export const TimerUpdateInput = z.object({
  taskId: id.nullable().optional(),
  note: z.string().max(5000).optional(),
  billable: z.boolean().optional(),
  /** move the first segment's start (explicit edit, a wall time already resolved to an instant) */
  startedAt: z.string().datetime().optional(),
});

export const SegmentInput = z.object({
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
});

export const TimeEntryInput = z.object({
  taskId: id,
  memberId: id.optional(),
  date,
  tz: z.string().optional(),
  /** either segments (start–end mode) or durationSeconds (duration mode) */
  segments: z.array(SegmentInput).min(1).max(50).optional(),
  durationSeconds: z
    .number()
    .int()
    .min(1)
    .max(86400 * 2)
    .optional(),
  note: z.string().max(5000).default(""),
  billable: z.boolean().optional(),
  version: z.number().int().optional(),
});
export type TimeEntryInput = z.infer<typeof TimeEntryInput>;

export const OffInvoiceInput = z.object({
  entryIds: z.array(id).min(1).max(1000),
  kind: z.enum(["billed_elsewhere", "written_off"]).nullable(),
  ref: z.string().max(200).optional(),
  note: z.string().max(1000).optional(),
});

export const LineLayoutInput = z.object({
  mode: z.enum(["per_task", "per_task_week", "per_entry"]),
  showDates: z.boolean(),
  showNotes: z.boolean(),
});

export const CreateDraftInput = z.object({
  clientId: id,
  entryIds: z.array(id).max(5000).default([]),
  fixed: z.array(z.object({ taskId: id, amountMinor: minor.min(1) })).default([]),
  layout: LineLayoutInput,
  summary: z.string().max(500).optional(),
});

export const DraftLineInput = z.object({
  id: id.optional(),
  kind: z.enum(["time", "fixed", "manual", "discount"]),
  title: z.string().max(1000),
  detail: z.string().max(10000).default(""),
  qtyHundredths: z.number().int().min(0).max(100000000),
  unit: z.string().max(20).default(""),
  rateMinor: z.number().int().min(-2147483647).max(2147483647),
  discountRateBp: z.number().int().min(0).max(10000).nullable().optional(),
  taxIds: z.array(z.string()).default([]),
});

export const DraftUpdateInput = z.object({
  summary: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  termsDays: z.number().int().min(0).max(365).optional(),
  dueDate: date.nullable().optional(),
  issueDate: date.nullable().optional(),
  paymentAccountMode: z.enum(["default", "account", "none"]).optional(),
  paymentAccountId: id.nullable().optional(),
  lines: z.array(DraftLineInput).max(2000).optional(),
  taxes: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(50),
        rateBp: z.number().int().min(0).max(10000),
      }),
    )
    .max(10)
    .optional(),
  changeSummary: z.string().max(2000).optional(),
});

export const SendInput = z.object({
  idempotencyKey: z.string().uuid(),
  to: z.array(z.string().email()).min(1).max(10),
  cc: z.array(z.string().email()).max(10).default([]),
  subject: z.string().min(1).max(300),
  message: z.string().min(1).max(20000),
  issueDate: date.optional(),
  kind: z.enum(["invoice", "correction", "reminder", "test"]).default("invoice"),
});

export const MarkSentInput = z.object({ issueDate: date.optional() });

export const PaymentInput = z.object({
  kind: z.enum(["payment", "refund"]).default("payment"),
  amountMinor: minor.min(1),
  receivedOn: date,
  method: z.enum(["bank_transfer", "card", "cash", "other"]).default("bank_transfer"),
  note: z.string().max(1000).optional(),
});

export const VoidInput = z.object({ reason: z.string().max(500).optional() });

export const ApproveCorrectionInput = z.object({
  changeSummary: z.string().trim().min(1).max(2000),
  send: SendInput.omit({ kind: true }).optional(),
});

export const WorkspaceSettingsInput = z.object({
  name: z.string().min(1).max(200).optional(),
  businessName: z.string().max(200).optional(),
  senderName: z.string().max(200).optional(),
  address: z.string().max(1000).optional(),
  phone: z.string().max(50).optional(),
  taxId: z.string().max(100).optional(),
  billingEmail: z.string().email().or(z.literal("")).optional(),
  currency: currency.optional(),
  timeZone: z.string().optional(),
  defaultRateMinor: minor.nullable().optional(),
  defaultTermsDays: z.number().int().min(0).max(365).optional(),
  numberFormat: z.string().min(1).max(50).optional(),
  numberReset: z.enum(["never", "yearly"]).optional(),
  nextNumber: z.number().int().min(1).optional(),
  defaultNotes: z.string().max(5000).optional(),
});

export const DefaultTaxInput = z.object({
  name: z.string().trim().min(1).max(50),
  rateBp: z.number().int().min(0).max(10000),
});

export const PaymentAccountInput = z.object({
  currency,
  label: z.string().trim().min(1).max(100),
  beneficiaryName: z.string().max(200).default(""),
  beneficiaryAddress: z.string().max(500).default(""),
  bankName: z.string().max(200).default(""),
  bankAddress: z.string().max(500).default(""),
  accountNumber: z.string().max(100).nullable().optional(),
  iban: z.string().max(100).nullable().optional(),
  swiftBic: z.string().max(50).nullable().optional(),
  routingNumber: z.string().max(50).nullable().optional(),
  correspondentBankName: z.string().max(200).nullable().optional(),
  correspondentAccount: z.string().max(100).nullable().optional(),
  correspondentSwift: z.string().max(50).nullable().optional(),
  referenceHint: z.string().max(200).nullable().optional(),
  instructions: z.string().max(1000).nullable().optional(),
  isDefault: z.boolean().default(false),
});

export const MemberInviteInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
});

export const ProfileInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timeZone: z.string().optional(),
  timeFormat: z.enum(["12h", "24h"]).optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
  password: z.string().min(8).max(200).optional(),
});

export const AcceptInviteInput = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(200),
  tz: z.string().optional(),
});
