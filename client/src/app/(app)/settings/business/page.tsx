import { CURRENCY_CODES } from "@paypure/domain";
import { redirect } from "next/navigation";
import {
  addAccount,
  makeDefaultAccount,
  removeAccount,
  updateAccount,
  updateWorkspace,
} from "@/app/actions/settings";
import { Field } from "@/components/settings-fields";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/toaster";
import { api, getMe } from "@/server/api";

export const metadata = { title: "Business" };

export interface Account {
  id: string;
  currency: string;
  label: string;
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
  isDefault: boolean;
  archivedAt: string | null;
  used: boolean;
}

interface WorkspaceSettings {
  workspace: {
    name: string;
    currency: string;
    businessName: string;
    senderName: string;
    address: string;
    phone: string;
    taxId: string;
    billingEmail: string;
  };
  accounts: Account[];
}

function AccountFields({ a, workspaceCurrency }: { a?: Account; workspaceCurrency: string }) {
  const p = a?.id ?? "new";
  const f = (
    name: keyof Account,
    label: string,
    extra: { hint?: string; textarea?: boolean } = {},
  ) => (
    <Field
      idPrefix={p}
      name={name}
      label={label}
      defaultValue={(a?.[name] as string | null) ?? ""}
      {...extra}
    />
  );
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-[1fr_140px] gap-3">
        <Field
          idPrefix={p}
          name="label"
          label="Label"
          defaultValue={a?.label}
          required
          hint="Shown only in pickers, e.g. “Mercury USD”."
        />
        <div>
          <label className="label" htmlFor={`cur-${p}`}>
            Currency
          </label>
          <select
            id={`cur-${p}`}
            name="currency"
            className="select"
            defaultValue={a?.currency ?? workspaceCurrency}
          >
            {CURRENCY_CODES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      {f("instructions", "Instructions", {
        hint: "Printed first, e.g. “Leave the reference and comment fields empty”.",
        textarea: true,
      })}
      <div className="grid sm:grid-cols-2 gap-3">
        {f("beneficiaryName", "Beneficiary name")}
        {f("beneficiaryAddress", "Beneficiary address")}
        {f("bankName", "Bank name")}
        {f("bankAddress", "Bank address")}
        {f("accountNumber", "Account number", {
          hint: "An account number or an IBAN is required.",
        })}
        {f("iban", "IBAN")}
        {f("swiftBic", "SWIFT/BIC")}
        {f("routingNumber", "Routing number")}
      </div>
      <fieldset className="space-y-3">
        <legend className="label">Correspondent bank (optional, for USD wires)</legend>
        <div className="grid sm:grid-cols-3 gap-3">
          {f("correspondentBankName", "Bank name")}
          {f("correspondentAccount", "Account")}
          {f("correspondentSwift", "SWIFT")}
        </div>
      </fieldset>
      {f("referenceHint", "Payment reference", {
        hint: "Shown and copyable on the public page only when set.",
      })}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="isDefault" defaultChecked={a?.isDefault ?? false} />
        Default account for its currency
      </label>
    </div>
  );
}

/** Settings · Business (S16): profile printed on invoices, and payment accounts (07 §8). */
export default async function BusinessPage() {
  const me = (await getMe())!;
  if (!me.isAdmin) redirect("/settings/profile");
  const { workspace: ws, accounts } = await api<WorkspaceSettings>("/v1/settings/workspace");
  const active = accounts.filter((a) => !a.archivedAt);
  const archived = accounts.filter((a) => a.archivedAt);
  const currenciesWithoutDefault = [...new Set(active.map((a) => a.currency))].filter(
    (c) => !active.some((a) => a.currency === c && a.isDefault),
  );

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h2 className="t-title-2 mb-1">Business profile</h2>
        <p className="text-muted mb-5">
          Printed in the From block of drafts. Sent invoices keep what they were sent with.
        </p>
        <ActionForm action={updateWorkspace} className="space-y-4" autoComplete="on">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field
              name="businessName"
              label="Business name"
              defaultValue={ws.businessName}
              required
              autoComplete="organization"
            />
            <Field
              name="senderName"
              label="Sender name"
              defaultValue={ws.senderName}
              autoComplete="name"
            />
          </div>
          <Field
            name="address"
            label="Address"
            defaultValue={ws.address}
            textarea
            rows={3}
            hint="One line per row, as it should print."
          />
          <div className="grid sm:grid-cols-3 gap-3">
            <Field
              name="phone"
              label="Phone"
              type="tel"
              defaultValue={ws.phone}
              autoComplete="tel"
            />
            <Field name="taxId" label="Tax ID" defaultValue={ws.taxId} />
            <Field
              name="billingEmail"
              label="Billing email (reply-to)"
              type="email"
              defaultValue={ws.billingEmail}
              autoComplete="email"
            />
          </div>
          <Submit pendingText="Saving…">Save business profile</Submit>
        </ActionForm>
      </section>

      <section className="card p-6">
        <h2 className="t-title-2 mb-1">Payment accounts</h2>
        <p className="text-muted mb-4">
          Several per currency, one default each. An invoice uses the client's default, then the
          default for its currency.
        </p>
        {currenciesWithoutDefault.length > 0 && (
          <p className="banner banner-warning mb-4 text-sm">
            No default account for {currenciesWithoutDefault.join(", ")}. Mark one as default.
          </p>
        )}
        <ul className="divide-y divide-[var(--border)] border-y border-line">
          {active.map((a) => (
            <li key={a.id} className="py-3">
              <details>
                <summary className="flex items-center gap-3 cursor-pointer list-none">
                  <span className="pill">{a.currency}</span>
                  <span className="font-medium">{a.label}</span>
                  {a.isDefault && <span className="chip chip-info plain">Default</span>}
                  <span className="text-muted truncate">
                    {a.bankName}{" "}
                    {(a.iban ?? a.accountNumber ?? "").slice(-4)
                      ? `· …${(a.iban ?? a.accountNumber ?? "").slice(-4)}`
                      : ""}
                  </span>
                  <span className="ml-auto text-accent font-medium">Edit</span>
                </summary>
                <div className="pt-4 space-y-4">
                  <ActionForm action={updateAccount} className="space-y-4">
                    <input type="hidden" name="id" value={a.id} />
                    <AccountFields a={a} workspaceCurrency={ws.currency} />
                    <Submit pendingText="Saving…">Save account</Submit>
                  </ActionForm>
                  <div className="flex gap-2 border-t border-line pt-4">
                    {!a.isDefault && (
                      <ActionForm action={makeDefaultAccount}>
                        <input type="hidden" name="id" value={a.id} />
                        <Submit className="btn btn-secondary btn-sm">Make default</Submit>
                      </ActionForm>
                    )}
                    <ActionForm action={removeAccount}>
                      <input type="hidden" name="id" value={a.id} />
                      <Submit
                        className="btn btn-ghost btn-sm text-danger"
                        title={
                          a.used
                            ? "Used by a sent invoice, so it's archived instead of deleted"
                            : undefined
                        }
                      >
                        {a.used ? "Archive" : "Delete"}
                      </Submit>
                    </ActionForm>
                  </div>
                </div>
              </details>
            </li>
          ))}
          {active.length === 0 && (
            <li className="py-4 text-muted">
              No payment accounts yet. Invoices will print without bank details.
            </li>
          )}
        </ul>
        {archived.length > 0 && (
          <p className="t-caption mt-3">
            Archived: {archived.map((a) => `${a.label} (${a.currency})`).join(", ")}. Invoices sent
            with them keep their details.
          </p>
        )}
        <details className="mt-4">
          <summary className="btn btn-secondary cursor-pointer list-none inline-flex">
            Add account
          </summary>
          <ActionForm action={addAccount} className="space-y-4 pt-4" reset>
            <AccountFields workspaceCurrency={ws.currency} />
            <Submit pendingText="Adding…">Add account</Submit>
          </ActionForm>
        </details>
      </section>
    </div>
  );
}
