import { type DisplayStatus, formatDateLong, formatMoney, type SheetData } from "@paypure/domain";
import { notFound } from "next/navigation";
import { CopyButton, PrintButton, ViewedBeacon } from "@/components/public-ready";
import { InvoiceSheet } from "@/components/sheet";
import { api, getMe } from "@/server/api";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

interface PublicInvoice {
  sheet: SheetData;
  status: DisplayStatus;
  voided: boolean;
  businessName: string;
  payments: { kind: "payment" | "refund"; amountMinor: number; receivedOn: string }[];
  versions: { id: string; rev: number; frozenAt: string; changeSummary: string | null }[];
}

/** S15: the client sees the invoice and how to pay it, with no login. Mobile-first. */
export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let data: PublicInvoice;
  try {
    data = await api<PublicInvoice>(`/v1/public/invoices/${encodeURIComponent(token)}`, {
      token: null,
    });
  } catch {
    notFound();
  }
  // Views by signed-in members of the workspace aren't logged (08 §10).
  const member = await getMe().catch(() => null);
  const { sheet, status } = data;
  const m = (minor: number) => formatMoney({ minor, currency: sheet.currency }, { withCode: true });
  const statusLine = data.voided
    ? "This invoice was voided"
    : status.key === "paid"
      ? `Paid · thank you${status.overpaidMinor ? ` (overpaid ${m(status.overpaidMinor)})` : ""}`
      : `${sheet.dueDate ? `Due ${formatDateLong(sheet.dueDate)} · ` : ""}${m(status.balanceMinor)} outstanding`;
  const acc = sheet.paymentAccount;
  const accRows: [string, string | null][] = acc
    ? [
        ["Beneficiary", acc.beneficiaryName],
        ["Beneficiary address", acc.beneficiaryAddress],
        ["Bank", acc.bankName],
        ["Bank address", acc.bankAddress],
        ["Account number", acc.accountNumber],
        ["IBAN", acc.iban],
        ["Routing number", acc.routingNumber],
        ["SWIFT/BIC", acc.swiftBic],
        ["Correspondent bank", acc.correspondentBankName],
        ["Correspondent account", acc.correspondentAccount],
        ["Correspondent SWIFT", acc.correspondentSwift],
        ["Reference", acc.referenceHint],
      ]
    : [];
  const previous = data.versions.slice(1);

  return (
    <main className="mx-auto max-w-[848px] px-4 py-6 sm:py-10 space-y-6">
      {!member && <ViewedBeacon token={token} />}
      <header className="space-y-3">
        <div className="t-title-2">{data.businessName}</div>
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <p
            className={`t-title-3 ${data.voided ? "text-muted line-through" : status.key === "paid" ? "text-success" : status.key === "overdue" ? "text-danger" : ""}`}
          >
            {statusLine}
          </p>
          <div className="flex gap-2 print:hidden">
            <a href={`/i/${token}/pdf`} className="btn btn-primary">
              Download PDF
            </a>
            <PrintButton />
          </div>
        </div>
      </header>

      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="min-w-[640px] sm:min-w-0">
          <InvoiceSheet s={sheet} />
        </div>
      </div>

      {acc && !data.voided && status.key !== "paid" && (
        <section className="card p-5 print:hidden">
          <h2 className="t-title-3 mb-2">How to pay</h2>
          {acc.instructions && <p className="banner mb-3 font-medium">{acc.instructions}</p>}
          <dl className="divide-y divide-[var(--border)]">
            {accRows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 py-2">
                  <dt className="t-caption w-40 shrink-0">{k}</dt>
                  <dd className="flex-1 min-w-0 break-words tnum">{v}</dd>
                  <CopyButton value={v as string} label={k} />
                </div>
              ))}
          </dl>
        </section>
      )}

      {data.payments.length > 0 && (
        <section className="card p-5">
          <h2 className="t-title-3 mb-2">Payments</h2>
          <table className="table">
            <tbody>
              {data.payments.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: payments have no public id
                <tr key={i}>
                  <td>{formatDateLong(p.receivedOn)}</td>
                  <td>{p.kind === "refund" ? "Refund" : "Payment received"}</td>
                  <td className="num">
                    {p.kind === "refund" ? "−" : ""}
                    {m(p.amountMinor)}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} className="font-semibold">
                  {status.balanceMinor < 0 ? "Overpaid" : "Balance"}
                </td>
                <td className="num font-semibold">{m(Math.abs(status.balanceMinor))}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {previous.length > 0 && (
        <section className="card p-5 print:hidden">
          <h2 className="t-title-3 mb-2">Previous versions</h2>
          <ul className="divide-y divide-[var(--border)]">
            {previous.map((v) => (
              <li key={v.id} className="flex items-center gap-3 py-2">
                <span className="font-medium">Revision {v.rev}</span>
                <span className="text-muted">{formatDateLong(v.frozenAt.slice(0, 10))}</span>
                <span className="flex-1 min-w-0 truncate text-muted">{v.changeSummary ?? ""}</span>
                <a href={`/i/${token}/pdf?version=${v.id}`} className="text-accent font-medium">
                  PDF
                </a>
              </li>
            ))}
          </ul>
          <p className="t-caption mt-2">The latest revision above replaces these.</p>
        </section>
      )}

      <footer className="t-caption text-center pt-4">Sent with Paypure</footer>
    </main>
  );
}
