import { type ChipTone, formatDateLong, formatHoursMinutes, formatMoney, minorToDecimalString } from "@paypure/domain";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  archiveClient,
  createProject,
  deleteClient,
  duplicateInvoice,
  restoreClient,
  updateClient,
} from "@/app/actions/catalog";
import { ColourPicker, CurrencySelect, Field, moneyValue } from "@/components/catalog-fields";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/toaster";
import { ClientBadge, Empty, Money, PageHeader, Progress, Stat, StatStrip, StatusChip, Tabs } from "@/components/ui";
import { api, ApiError, getMe } from "@/server/api";

interface Project {
  id: string;
  name: string;
  status: "active" | "completed";
  rateMinor?: number | null;
  budgetKind: "hours" | "money" | null;
  budgetValue?: number | null;
  trackedSeconds: number;
  unbilledMinor?: number;
}

interface InvoiceRow {
  id: string;
  number: string | null;
  status: "draft" | "issued" | "void";
  rev: number;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  totalMinor: number;
  balanceMinor: number;
  display: { label: string; tone: ChipTone };
}

interface ClientData {
  id: string;
  name: string;
  colour: number;
  currency: string;
  contactName: string;
  billingEmails: string[];
  address: string;
  taxId: string;
  rateMinor?: number | null;
  termsDays: number | null;
  notes: string;
  archivedAt: string | null;
  currencyLocked: boolean;
  canDelete: boolean;
  projects: Project[];
  stats?: {
    unbilledMinor: number;
    unbilledSeconds: number;
    noRateSeconds: number;
    outstandingMinor: number;
    overdueMinor: number;
    invoicedThisYearMinor: number;
  };
  invoices?: InvoiceRow[];
  lastInvoice?: InvoiceRow | null;
}

const TABS = ["overview", "projects", "invoices", "details"] as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const c = await api<ClientData>(`/v1/clients/${id}`);
    return { title: c.name };
  } catch {
    return { title: "Client" };
  }
}

/** Client (S7): Overview · Projects · Invoices · Details. */
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const me = (await getMe())!;
  const { id } = await params;
  const { tab: tabQ } = await searchParams;
  let c: ClientData;
  try {
    c = await api<ClientData>(`/v1/clients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const tabs = me.isAdmin ? TABS : (["overview", "projects"] as const);
  const tab = (tabs as readonly string[]).includes(tabQ ?? "") ? (tabQ as (typeof TABS)[number]) : "overview";
  const m = (minor: number) => ({ minor, currency: c.currency });
  const nothingUnbilled = (c.stats?.unbilledMinor ?? 0) === 0 && (c.stats?.unbilledSeconds ?? 0) === 0;
  const active = c.projects.filter((p) => p.status === "active");

  return (
    <div>
      <PageHeader
        crumbs={[{ href: "/clients", label: "Clients" }]}
        title={
          <span className="flex items-center gap-3">
            <ClientBadge name={c.name} colour={c.colour} size={32} />
            {c.name}
          </span>
        }
        chip={c.archivedAt ? <StatusChip label="Archived" tone="neutral" /> : null}
        actions={
          me.isAdmin ? (
            <>
              <details className="menu relative">
                <summary className="btn btn-ghost btn-icon" aria-label="More actions">
                  ⋯
                </summary>
                <div className="menu-body pop right-0 mt-1">
                  <Link href={`/clients/${c.id}?tab=details`} className="menu-item">
                    Edit
                  </Link>
                  <ActionForm action={c.archivedAt ? restoreClient : archiveClient} showError={false}>
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" className="menu-item">
                      {c.archivedAt ? "Restore" : "Archive"}
                    </button>
                  </ActionForm>
                  {c.canDelete ? (
                    <details>
                      <summary className="menu-item danger">Delete…</summary>
                      {/* Irreversible and takes data with it: confirm with the consequence (Guide §5.14) */}
                      <ActionForm action={deleteClient} className="p-2 max-w-[260px] space-y-2">
                        <input type="hidden" name="id" value={c.id} />
                        <p className="text-[13px]">
                          Delete {c.name}? Its {c.projects.length} projects, their tasks and time entries go too. This can't be undone.
                        </p>
                        <Submit className="btn btn-danger btn-sm w-full" pendingText="Deleting…">
                          Delete client
                        </Submit>
                      </ActionForm>
                    </details>
                  ) : (
                    <span className="menu-item text-faint cursor-not-allowed" title="Clients with sent invoices are kept for your records.">
                      Delete (has sent invoices)
                    </span>
                  )}
                </div>
              </details>
              <Link href={`/clients/${c.id}?tab=projects#new-project`} className="btn btn-secondary">
                New project
              </Link>
              {nothingUnbilled ? (
                <span className="btn btn-primary" aria-disabled="true" title={`${c.name} has no unbilled time.`}>
                  Create invoice
                </span>
              ) : (
                <Link href={`/invoices/new?client=${c.id}`} className="btn btn-primary">
                  Create invoice
                </Link>
              )}
            </>
          ) : null
        }
      />
      <Tabs
        items={tabs.map((t) => ({
          href: `/clients/${c.id}?tab=${t}`,
          label: t[0].toUpperCase() + t.slice(1),
          current: t === tab,
        }))}
      />

      {tab === "overview" && (
        <div className="space-y-6">
          {c.stats && (
            <StatStrip>
              <Stat label="Unbilled" href={nothingUnbilled ? undefined : `/invoices/new?client=${c.id}`}>
                <Money m={m(c.stats.unbilledMinor)} />
                {c.stats.noRateSeconds > 0 && (
                  <Link href={`/clients/${c.id}?tab=details`} className="block t-caption text-warning mt-1">
                    Set a rate to bill {formatHoursMinutes(c.stats.noRateSeconds)}
                  </Link>
                )}
              </Stat>
              <Stat label="Outstanding">
                <Money m={m(c.stats.outstandingMinor)} />
              </Stat>
              <Stat label="Overdue">
                <span style={c.stats.overdueMinor ? { color: "var(--danger-fg)" } : undefined}>
                  <Money m={m(c.stats.overdueMinor)} />
                </span>
              </Stat>
              <Stat label="Invoiced this year">
                <Money m={m(c.stats.invoicedThisYearMinor)} />
              </Stat>
            </StatStrip>
          )}

          <div className="grid lg:grid-cols-[1fr_340px] gap-6">
            <section>
              <h2 className="t-title-2 mb-3">Active projects</h2>
              {active.length === 0 ? (
                <Empty
                  action={
                    me.isAdmin ? (
                      <Link href={`/clients/${c.id}?tab=projects#new-project`} className="btn btn-primary">
                        Add a project
                      </Link>
                    ) : null
                  }
                >
                  No active projects.
                </Empty>
              ) : (
                <ProjectList projects={active} currency={c.currency} isAdmin={me.isAdmin} />
              )}
            </section>
            {me.isAdmin && (
              <section>
                <h2 className="t-title-2 mb-3">Last invoice</h2>
                {c.lastInvoice ? (
                  <div className="card p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <Link href={`/invoices/${c.lastInvoice.id}`} className="font-semibold tnum hover:text-accent">
                        {c.lastInvoice.number}
                      </Link>
                      <StatusChip label={c.lastInvoice.display.label} tone={c.lastInvoice.display.tone} />
                    </div>
                    <div className="flex justify-between text-muted">
                      <span>{c.lastInvoice.issueDate ? formatDateLong(c.lastInvoice.issueDate) : "—"}</span>
                      <span className="tnum text-ink font-semibold">
                        {formatMoney({ minor: c.lastInvoice.totalMinor, currency: c.lastInvoice.currency })}
                      </span>
                    </div>
                    {/* The fast path for monthly fixed invoices (F7) */}
                    <ActionForm action={duplicateInvoice}>
                      <input type="hidden" name="invoiceId" value={c.lastInvoice.id} />
                      <Submit className="btn btn-secondary w-full" pendingText="Duplicating…">
                        Duplicate
                      </Submit>
                    </ActionForm>
                  </div>
                ) : (
                  <Empty>No invoices yet.</Empty>
                )}
              </section>
            )}
          </div>

          {me.isAdmin && c.invoices && c.invoices.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="t-title-2">Latest invoices</h2>
                <Link href={`/clients/${c.id}?tab=invoices`} className="text-accent font-medium">
                  All invoices
                </Link>
              </div>
              <InvoiceTable invoices={c.invoices.slice(0, 5)} />
            </section>
          )}
        </div>
      )}

      {tab === "projects" && (
        <div className="space-y-6">
          {c.projects.length === 0 ? (
            <Empty>No projects yet.</Empty>
          ) : (
            <>
              <ProjectList projects={active} currency={c.currency} isAdmin={me.isAdmin} />
              {c.projects.some((p) => p.status === "completed") && (
                <details>
                  <summary className="cursor-pointer text-muted font-medium">
                    {c.projects.filter((p) => p.status === "completed").length} completed
                  </summary>
                  <div className="mt-3">
                    <ProjectList projects={c.projects.filter((p) => p.status === "completed")} currency={c.currency} isAdmin={me.isAdmin} />
                  </div>
                </details>
              )}
            </>
          )}
          {me.isAdmin && (
            <section id="new-project" className="card p-5 max-w-[640px]">
              <h2 className="t-title-3 mb-3">New project</h2>
              <ActionForm action={createProject} className="flex gap-3 items-end flex-wrap">
                <input type="hidden" name="clientId" value={c.id} />
                <input type="hidden" name="currency" value={c.currency} />
                <div className="flex-1 min-w-[200px]">
                  <Field name="name" label="Name">
                    <input id="f-name" name="name" className="input" required autoFocus={tab === "projects" && active.length === 0} />
                  </Field>
                </div>
                <div className="w-36">
                  <Field name="rate" label={`Rate (${c.currency}/h)`}>
                    <input
                      id="f-rate"
                      name="rate"
                      className="input"
                      inputMode="decimal"
                      placeholder={c.rateMinor != null ? minorToDecimalString(c.rateMinor, c.currency) : "Optional"}
                    />
                  </Field>
                </div>
                <Submit pendingText="Adding…">Add project</Submit>
              </ActionForm>
              <p className="hint mt-2">Leave the rate empty to inherit the client's.</p>
            </section>
          )}
        </div>
      )}

      {tab === "invoices" && me.isAdmin && (
        <div>
          {c.invoices && c.invoices.length > 0 ? <InvoiceTable invoices={c.invoices} /> : <Empty>No invoices for {c.name} yet.</Empty>}
        </div>
      )}

      {tab === "details" && me.isAdmin && (
        <ActionForm action={updateClient} className="card p-6 space-y-4 max-w-[640px]">
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="currentCurrency" value={c.currency} />
          <Field name="name" label="Name">
            <input id="f-name" name="name" className="input" required defaultValue={c.name} autoComplete="organization" />
          </Field>
          <Field name="contactName" label="Contact name">
            <input id="f-contactName" name="contactName" className="input" defaultValue={c.contactName} autoComplete="name" />
          </Field>
          <Field name="billingEmails" label="Billing emails" hint="Separate several with commas.">
            <input id="f-billingEmails" name="billingEmails" className="input" defaultValue={c.billingEmails.join(", ")} autoComplete="email" />
          </Field>
          <Field name="address" label="Address">
            <textarea id="f-address" name="address" className="textarea" rows={3} defaultValue={c.address} autoComplete="street-address" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field name="taxId" label="Tax ID">
              <input id="f-taxId" name="taxId" className="input" defaultValue={c.taxId} />
            </Field>
            <Field name="termsDays" label="Payment terms (days)" hint="Empty uses the workspace default.">
              <input id="f-termsDays" name="termsDays" type="number" min={0} max={365} className="input" defaultValue={c.termsDays ?? ""} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              name="currency"
              label="Currency"
              hint={
                c.currencyLocked
                  ? `Locked: ${c.name} already has invoices in ${c.currency}.`
                  : "Rates stay as numbers, they aren't converted."
              }
            >
              <CurrencySelect value={c.currency} disabled={c.currencyLocked} />
            </Field>
            <Field name="rate" label="Hourly rate" hint="Empty: projects and tasks set their own, or the workspace default applies.">
              <input id="f-rate" name="rate" className="input" inputMode="decimal" defaultValue={moneyValue(c.rateMinor, c.currency)} />
            </Field>
          </div>
          <ColourPicker value={c.colour} />
          <Field name="notes" label="Notes">
            <textarea id="f-notes" name="notes" className="textarea" rows={3} defaultValue={c.notes} />
          </Field>
          <div className="pt-2">
            <Submit pendingText="Saving…">Save</Submit>
          </div>
        </ActionForm>
      )}
    </div>
  );
}

function ProjectList({ projects, currency, isAdmin }: { projects: Project[]; currency: string; isAdmin: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Budget</th>
            <th className="num">Hours</th>
            {isAdmin && <th className="num">Unbilled</th>}
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/projects/${p.id}`} className="font-semibold hover:text-accent">
                  {p.name}
                </Link>
                {isAdmin && p.rateMinor != null && (
                  <span className="pill ml-2">{formatMoney({ minor: p.rateMinor, currency })}/h</span>
                )}
              </td>
              <td className="w-48">
                {p.budgetKind === "hours" && p.budgetValue ? (
                  <div className="space-y-1">
                    <Progress value={p.trackedSeconds} max={p.budgetValue} />
                    <span className="t-caption">
                      {formatHoursMinutes(p.trackedSeconds)} of {formatHoursMinutes(p.budgetValue)}
                    </span>
                  </div>
                ) : p.budgetKind === "money" && p.budgetValue && isAdmin ? (
                  <span className="t-caption">{formatMoney({ minor: p.budgetValue, currency })} budget</span>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>
              <td className="num">{p.trackedSeconds ? formatHoursMinutes(p.trackedSeconds) : <span className="text-faint">—</span>}</td>
              {isAdmin && (
                <td className="num">
                  <Money m={{ minor: p.unbilledMinor ?? 0, currency }} dash />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceTable({ invoices }: { invoices: InvoiceRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Number</th>
            <th>Issued</th>
            <th>Due</th>
            <th className="num">Total</th>
            <th className="num">Balance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td>
                <Link href={`/invoices/${i.id}`} className={`font-semibold tnum hover:text-accent ${i.status === "void" ? "line-through text-muted" : ""}`}>
                  {i.number ?? "Draft"}
                </Link>
                {i.rev > 1 && <span className="t-caption ml-1">rev {i.rev}</span>}
              </td>
              <td className="text-muted">{i.issueDate ? formatDateLong(i.issueDate) : "—"}</td>
              <td className="text-muted">{i.dueDate ? formatDateLong(i.dueDate) : "—"}</td>
              <td className="num">{formatMoney({ minor: i.totalMinor, currency: i.currency })}</td>
              <td className="num">
                <Money m={{ minor: i.status === "issued" ? i.balanceMinor : 0, currency: i.currency }} dash />
              </td>
              <td>
                <StatusChip label={i.display.label} tone={i.display.tone} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
