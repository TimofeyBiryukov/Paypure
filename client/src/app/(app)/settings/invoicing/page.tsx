import { CURRENCY_CODES, formatPercentBp, minorToDecimalString } from "@paypure/domain";
import { redirect } from "next/navigation";
import { addTax, removeTax, updateTemplate, updateWorkspace } from "@/app/actions/settings";
import { Field, timeZones } from "@/components/settings-fields";
import { Submit } from "@/components/submit";
import { ActionForm, FieldError } from "@/components/toaster";
import { api, getMe } from "@/server/api";

export const metadata = { title: "Invoicing" };

interface InvoicingSettings {
  workspace: {
    currency: string;
    timeZone: string;
    defaultRateMinor: number | null;
    defaultTermsDays: number;
    numberFormat: string;
    numberReset: "never" | "yearly";
    defaultNotes: string;
  };
  taxes: { id: string; name: string; rateBp: number }[];
  templates: { kind: "invoice" | "correction" | "reminder" | "thank_you"; subject: string; body: string }[];
  numbering: { next: number; maxUsed: number; preview: string };
  publicLinks: boolean;
}

const TEMPLATE_LABELS = {
  invoice: "Send invoice",
  correction: "Correction",
  reminder: "Reminder",
  thank_you: "Thank-you",
} as const;

const VARIABLES = ["number", "client_name", "total", "balance", "due_date", "link", "business_name", "sender_name", "changes_summary", "days_overdue", "paid", "rev"];

/** Settings · Invoicing (S16): defaults, numbering (08 §6), taxes (07 §7), email templates. */
export default async function InvoicingPage() {
  const me = (await getMe())!;
  if (!me.isAdmin) redirect("/settings/profile");
  const { workspace: ws, taxes, templates, numbering, publicLinks } = await api<InvoicingSettings>("/v1/settings/workspace");
  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h2 className="t-title-2 mb-5">Defaults</h2>
        <ActionForm action={updateWorkspace} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="f-currency">
                Workspace currency
              </label>
              <select id="f-currency" name="currency" className="select" defaultValue={ws.currency}>
                {CURRENCY_CODES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <p className="hint">New clients start in this currency. The default rate is in it too.</p>
            </div>
            <div>
              <label className="label" htmlFor="f-timeZone">
                Workspace time zone
              </label>
              <select id="f-timeZone" name="timeZone" className="select" defaultValue={ws.timeZone}>
                {timeZones().map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
              <p className="hint">Used for invoice dates, Overdue and daily jobs.</p>
              <FieldError name="timeZone" />
            </div>
            <Field
              name="defaultRate"
              label={`Default hourly rate (${ws.currency})`}
              defaultValue={ws.defaultRateMinor == null ? "" : minorToDecimalString(ws.defaultRateMinor, ws.currency)}
              inputMode="decimal"
              placeholder="No default"
              hint="Applies only to clients in the workspace currency with no rate of their own."
            />
            <Field name="defaultTermsDays" label="Payment terms (days)" type="number" defaultValue={ws.defaultTermsDays} required />
          </div>
          <Field name="defaultNotes" label="Default notes" defaultValue={ws.defaultNotes} textarea hint="Printed in the Notes block of new drafts." />
          <Submit pendingText="Saving…">Save defaults</Submit>
        </ActionForm>
      </section>

      <section className="card p-6">
        <h2 className="t-title-2 mb-1">Numbering</h2>
        <p className="text-muted mb-5">
          One sequence. Numbers are assigned when an invoice is sent, so there are no gaps.
        </p>
        <ActionForm action={updateWorkspace} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field
              name="numberFormat"
              label="Format"
              defaultValue={ws.numberFormat}
              required
              hint="Tokens: {seq}, {seq:4} (zero-padded), {YYYY}, {YY}."
            />
            <Field
              name="nextNumber"
              label="Next number"
              type="number"
              defaultValue={numbering.next}
              hint={`It can only go up${numbering.maxUsed ? `, past ${numbering.maxUsed}` : ""}.`}
            />
          </div>
          <fieldset>
            <legend className="label">Reset the sequence</legend>
            <div className="seg">
              <label>
                <input type="radio" name="numberReset" value="never" defaultChecked={ws.numberReset === "never"} />
                Never
              </label>
              <label>
                <input type="radio" name="numberReset" value="yearly" defaultChecked={ws.numberReset === "yearly"} />
                Every year
              </label>
            </div>
          </fieldset>
          <p className="banner text-sm">
            Next: <span className="font-semibold tnum">{numbering.preview}</span>
          </p>
          <Submit pendingText="Saving…">Save numbering</Submit>
        </ActionForm>
      </section>

      <section className="card p-6">
        <h2 className="t-title-2 mb-1">Default taxes</h2>
        <p className="text-muted mb-4">Copied onto new drafts. Taxes are added on top and never compound.</p>
        <ul className="divide-y divide-[var(--border)] border-y border-line mb-4">
          {taxes.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <span className="font-medium flex-1">{t.name}</span>
              <span className="tnum">{formatPercentBp(t.rateBp)}</span>
              <ActionForm action={removeTax}>
                <input type="hidden" name="id" value={t.id} />
                <Submit className="btn btn-ghost btn-sm text-danger">Remove</Submit>
              </ActionForm>
            </li>
          ))}
          {taxes.length === 0 && <li className="py-3 text-muted">No taxes. Drafts start without tax.</li>}
        </ul>
        {/* Inline add row: a small form, Enter submits (Guide §7.1) */}
        <ActionForm action={addTax} reset className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="label" htmlFor="tax-name">
              Name
            </label>
            <input id="tax-name" name="name" className="input" placeholder="VAT" required />
            <FieldError name="name" />
          </div>
          <div className="w-[120px]">
            <label className="label" htmlFor="tax-rate">
              Rate %
            </label>
            <input id="tax-rate" name="rate" className="input" inputMode="decimal" placeholder="20" required />
            <FieldError name="rate" />
          </div>
          <Submit className="btn btn-secondary" pendingText="Adding…">
            Add tax
          </Submit>
        </ActionForm>
      </section>

      <section className="card p-6 space-y-5">
        <div>
          <h2 className="t-title-2 mb-1">Email templates</h2>
          <p className="text-muted">
            Variables:{" "}
            {VARIABLES.filter((v) => publicLinks || v !== "link").map((v) => (
              <code key={v} className="text-[12px] bg-sunken rounded px-1 mr-1">{`{{${v}}}`}</code>
            ))}
          </p>
          {!publicLinks && <p className="hint">Public invoice pages are off, so lines with {"{{link}}"} are left out of sent emails.</p>}
        </div>
        {templates.map((t) => (
          <details key={t.kind} className="border-t border-line pt-4">
            <summary className="t-title-3 cursor-pointer">{TEMPLATE_LABELS[t.kind]}</summary>
            <ActionForm action={updateTemplate} className="space-y-3 pt-3">
              <input type="hidden" name="kind" value={t.kind} />
              <Field idPrefix={`tpl-${t.kind}`} name="subject" label="Subject" defaultValue={t.subject} required />
              <Field idPrefix={`tpl-${t.kind}`} name="body" label="Message" defaultValue={t.body} textarea rows={8} />
              <Submit pendingText="Saving…">Save template</Submit>
            </ActionForm>
          </details>
        ))}
      </section>
    </div>
  );
}
