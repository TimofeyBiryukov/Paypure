import {
  formatDateLong,
  formatHundredths,
  formatMoney,
  formatPercentBp,
  type SheetData,
} from "@paypure/domain";
import { NoteMarkdown } from "./note-md";

/**
 * The invoice sheet (Guide §5.13): one component for the editor preview, the invoice page, the
 * public page and the PDF. It never shows payment state.
 */
export function InvoiceSheet({ s, scale }: { s: SheetData; scale?: number }) {
  const m = (minor: number) => formatMoney({ minor, currency: s.currency });
  const lines = (t: string) => t.split("\n").filter(Boolean);
  const acc = s.paymentAccount;
  return (
    <article
      className="invoice-sheet relative bg-white text-[#1B1A18] rounded-[12px] print:rounded-none"
      style={{
        width: 800,
        maxWidth: "100%",
        padding: 48,
        boxShadow: "var(--shadow-pop)",
        transform: scale ? `scale(${scale})` : undefined,
        transformOrigin: "top left",
        fontFeatureSettings: '"tnum" 1',
      }}
    >
      {s.watermark && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
          style={{ color: "rgba(179,38,30,.13)", fontSize: 64, fontWeight: 700, transform: "rotate(-30deg)" }}
        >
          DRAFT · not a valid invoice
        </div>
      )}
      <header className="flex justify-between gap-8 sheet-keep">
        <div className="min-w-0">
          <div className="text-[20px] leading-7 font-semibold">{s.from.businessName}</div>
          <div className="text-[12px] leading-4 text-[#5F5B54] mt-1 space-y-0.5">
            {s.from.senderName && <div>{s.from.senderName}</div>}
            {lines(s.from.address).map((l) => (
              <div key={l}>{l}</div>
            ))}
            {s.from.phone && <div>{s.from.phone}</div>}
            {s.from.email && <div>{s.from.email}</div>}
            {s.from.taxId && <div>Tax ID {s.from.taxId}</div>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[12px] tracking-[.08em] font-semibold text-[#5F5B54]">INVOICE</div>
          <div className="text-[20px] leading-7 font-semibold">{s.number ?? "Draft"}</div>
          {s.rev > 1 && (
            <div className="text-[12px] text-[#5F5B54]">
              Revision {s.rev}
              {s.revisedOn ? ` · revised ${formatDateLong(s.revisedOn)}` : ""}
            </div>
          )}
          <div className="text-[12px] text-[#5F5B54] mt-1">
            {s.issueDate ? `Issued ${formatDateLong(s.issueDate)}` : "Issued on send"}
            {s.dueDate ? ` · Due ${formatDateLong(s.dueDate)}` : ""}
          </div>
        </div>
      </header>

      <section className="flex justify-between gap-8 mt-10 sheet-keep">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-[#5F5B54]">Bill to</div>
          <div className="font-semibold mt-1">
            {s.to.name}
            {s.to.contactName ? <span className="font-normal"> · {s.to.contactName}</span> : null}
          </div>
          <div className="text-[12px] leading-4 text-[#5F5B54] mt-1 space-y-0.5">
            {lines(s.to.address).map((l) => (
              <div key={l}>{l}</div>
            ))}
            {s.to.taxId && <div>Tax ID {s.to.taxId}</div>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[12px] font-medium text-[#5F5B54]">Total due</div>
          <div className="text-[28px] leading-[34px] font-semibold">{m(s.totalMinor)}</div>
        </div>
      </section>

      {s.summary && (
        <section className="mt-8 sheet-keep">
          <div className="text-[12px] font-medium text-[#5F5B54]">Summary</div>
          <div className="mt-1">{s.summary}</div>
        </section>
      )}

      <table className="w-full mt-8 border-collapse text-[13px] leading-[18px]">
        <thead>
          <tr className="text-[12px] text-[#5F5B54] border-b border-[#1B1A18]">
            <th className="text-left font-medium py-2">Description</th>
            <th className="text-right font-medium py-2 w-[84px]">Qty</th>
            <th className="text-right font-medium py-2 w-[96px]">Rate</th>
            <th className="text-right font-medium py-2 w-[110px]">Amount</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no stable id in the sheet
            <tr key={i} className="border-b border-[#E4E1DB] align-top sheet-line">
              <td className="py-2.5 pr-4">
                <div className={l.kind === "manual" ? "whitespace-pre-line" : "font-semibold"}>
                  {l.kind === "discount" ? `Discount${l.discountRateBp ? ` ${formatPercentBp(l.discountRateBp)}` : ""}` : l.title}
                </div>
                {l.detail && <SheetNote text={l.detail} />}
              </td>
              <td className="py-2.5 text-right whitespace-nowrap">
                {l.kind === "discount" ? "" : l.unit === "h" ? `${formatHundredths(l.qtyHundredths)} h` : l.unit === "fixed" ? "1" : `${formatHundredths(l.qtyHundredths).replace(/\.00$/, "")}${l.unit ? ` ${l.unit}` : ""}`}
              </td>
              <td className="py-2.5 text-right whitespace-nowrap">{l.kind === "discount" ? "" : m(l.rateMinor)}</td>
              <td className="py-2.5 text-right whitespace-nowrap">{m(l.amountMinor)}</td>
            </tr>
          ))}
          {s.lines.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-[#8C877E]">
                No lines yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="flex justify-end mt-4 sheet-keep">
        <dl className="w-[300px] text-[13px] leading-[18px]">
          <div className="flex justify-between py-1">
            <dt className="text-[#5F5B54]">Subtotal</dt>
            <dd>{m(s.subtotalMinor)}</dd>
          </div>
          {s.taxes.map((t) => (
            <div key={t.name + t.rateBp} className="flex justify-between py-1">
              <dt className="text-[#5F5B54]">
                {t.name} {formatPercentBp(t.rateBp)}
              </dt>
              <dd>{m(t.amountMinor)}</dd>
            </div>
          ))}
          <div className="flex justify-between py-2 mt-1 border-t border-[#1B1A18] font-semibold text-[15px]">
            <dt>Total</dt>
            {/* On documents the code is always shown on totals (Guide §5.7) */}
            <dd>{formatMoney({ minor: s.totalMinor, currency: s.currency }, { withCode: true })}</dd>
          </div>
        </dl>
      </section>

      <footer className="grid grid-cols-2 gap-8 mt-10 text-[12px] leading-4 sheet-keep">
        <div>
          {acc && (
            <>
              <div className="font-medium text-[#5F5B54] mb-1">Payment details</div>
              {acc.instructions && <div className="font-semibold mb-2">{acc.instructions}</div>}
              <dl className="space-y-0.5">
                {[
                  ["Beneficiary", acc.beneficiaryName],
                  ["Address", acc.beneficiaryAddress],
                  ["Bank", acc.bankName],
                  ["Bank address", acc.bankAddress],
                  ["Account", acc.accountNumber],
                  ["IBAN", acc.iban],
                  ["Routing", acc.routingNumber],
                  ["SWIFT/BIC", acc.swiftBic],
                  ["Correspondent bank", acc.correspondentBankName],
                  ["Correspondent account", acc.correspondentAccount],
                  ["Correspondent SWIFT", acc.correspondentSwift],
                  ["Reference", acc.referenceHint],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="text-[#5F5B54] w-[130px] shrink-0">{k}</dt>
                      <dd className="break-words">{v}</dd>
                    </div>
                  ))}
              </dl>
            </>
          )}
        </div>
        <div>
          {s.notes && (
            <>
              <div className="font-medium text-[#5F5B54] mb-1">Notes</div>
              <SheetNote text={s.notes} />
            </>
          )}
        </div>
      </footer>
    </article>
  );
}

function SheetNote({ text }: { text: string }) {
  return <NoteMarkdown text={text} print className="text-[12px] leading-4 text-[#5F5B54] mt-1" />;
}
