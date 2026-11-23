import { redirect } from "next/navigation";
import { createClient } from "@/app/actions/catalog";
import { ColourPicker, CurrencySelect, Field } from "@/components/catalog-fields";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/toaster";
import { PageHeader } from "@/components/ui";
import { getMe } from "@/server/api";

export const metadata = { title: "New client" };

/** New client (S6). */
export default async function NewClientPage() {
  const me = (await getMe())!;
  if (!me.isAdmin) redirect("/clients");
  return (
    <div className="max-w-[640px]">
      <PageHeader title="New client" crumbs={[{ href: "/clients", label: "Clients" }]} />
      <ActionForm action={createClient} className="card p-6 space-y-4">
        <Field name="name" label="Name">
          <input
            id="f-name"
            name="name"
            className="input"
            required
            autoFocus
            autoComplete="organization"
          />
        </Field>
        <Field name="billingEmails" label="Billing emails" hint="Separate several with commas.">
          <input
            id="f-billingEmails"
            name="billingEmails"
            className="input"
            autoComplete="email"
            placeholder="jane@acme.example"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field name="currency" label="Currency" hint="Locked once the client has an invoice.">
            <CurrencySelect value={me.workspace.currency} />
          </Field>
          <Field name="rate" label="Hourly rate" hint="Optional. Projects and tasks inherit it.">
            <input
              id="f-rate"
              name="rate"
              className="input"
              inputMode="decimal"
              placeholder="90.00"
            />
          </Field>
        </div>
        <details className="group">
          <summary className="cursor-pointer text-accent font-medium list-none">
            More details ▾
          </summary>
          <div className="space-y-4 mt-4">
            <Field name="contactName" label="Contact name">
              <input id="f-contactName" name="contactName" className="input" autoComplete="name" />
            </Field>
            <Field
              name="address"
              label="Address"
              hint="Free text: foreign addresses don't fit fixed fields."
            >
              <textarea
                id="f-address"
                name="address"
                className="textarea"
                rows={3}
                autoComplete="street-address"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field name="taxId" label="Tax ID">
                <input id="f-taxId" name="taxId" className="input" />
              </Field>
              <Field
                name="termsDays"
                label="Payment terms (days)"
                hint="Empty uses the workspace default."
              >
                <input
                  id="f-termsDays"
                  name="termsDays"
                  type="number"
                  min={0}
                  max={365}
                  className="input"
                />
              </Field>
            </div>
            <ColourPicker />
          </div>
        </details>
        <div className="flex gap-2 pt-2">
          <Submit pendingText="Creating…">Create client</Submit>
          <a href="/clients" className="btn btn-ghost">
            Cancel
          </a>
        </div>
      </ActionForm>
    </div>
  );
}
