import { computeInvoice, type LineKind } from "./invoice";

/** The data behind the invoice sheet (Guide §5.13), the same for editor, public page and PDF. */
export interface FromSnapshot {
  businessName: string;
  senderName: string;
  address: string;
  phone: string;
  taxId: string;
  email: string;
}

export interface ToSnapshot {
  name: string;
  contactName: string;
  address: string;
  taxId: string;
  emails: string[];
}

export interface PaymentAccountSnapshot {
  label: string;
  currency: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  bankAddress: string;
  accountNumber: string | null;
  iban: string | null;
  swiftBic: string | null;
  routingNumber: string | null;
  correspondentBankName: string | null;
  correspondentAccount: string | null;
  correspondentSwift: string | null;
  referenceHint: string | null;
  instructions: string | null;
}

export interface SheetLine {
  kind: LineKind;
  title: string;
  detail: string;
  qtyHundredths: number;
  unit: string;
  rateMinor: number;
  amountMinor: number;
  discountRateBp?: number | null;
}

export interface SheetTax {
  name: string;
  rateBp: number;
  amountMinor: number;
}

export interface SheetData {
  number: string | null;
  rev: number;
  revisedOn: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  summary: string;
  notes: string;
  from: FromSnapshot;
  to: ToSnapshot;
  paymentAccount: PaymentAccountSnapshot | null;
  lines: SheetLine[];
  taxes: SheetTax[];
  subtotalMinor: number;
  totalMinor: number;
  watermark?: boolean;
}

export interface EditableLine {
  id?: string;
  kind: LineKind;
  title: string;
  detail: string;
  qtyHundredths: number;
  unit: string;
  rateMinor: number;
  discountRateBp?: number | null;
  taxIds: string[];
}

/** Lines + taxes → computed sheet lines and totals (07 §6), used by the editor preview and the API. */
export function sheetFromLines(
  lines: EditableLine[],
  taxes: { id: string; name: string; rateBp: number }[],
): Pick<SheetData, "lines" | "taxes" | "subtotalMinor" | "totalMinor"> & { errors: string[] } {
  // The discount line always sits last above the subtotal (07 §7.2).
  const ordered = [
    ...lines.filter((l) => l.kind !== "discount"),
    ...lines.filter((l) => l.kind === "discount"),
  ];
  const c = computeInvoice(ordered, taxes);
  return {
    lines: ordered.map((l, i) => ({
      kind: l.kind,
      title: l.title,
      detail: l.detail,
      qtyHundredths: c.lines[i].qtyHundredths,
      unit: l.unit,
      rateMinor: c.lines[i].rateMinor,
      amountMinor: c.lines[i].amountMinor,
      discountRateBp: l.discountRateBp ?? null,
    })),
    taxes: c.taxes.map((t) => ({ name: t.name, rateBp: t.rateBp, amountMinor: t.amountMinor })),
    subtotalMinor: c.subtotalMinor,
    totalMinor: c.totalMinor,
    errors: c.errors,
  };
}

/** Template variables `{{name}}` (S12). Returns the text and the names it couldn't fill. */
export function fillTemplate(template: string, vars: Record<string, string | undefined>) {
  const missing = new Set<string>();
  const text = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => {
    const v = vars[k];
    if (v === undefined || v === "") {
      missing.add(k);
      return m;
    }
    return v;
  });
  return { text, missing: [...missing] };
}
