import { formatHoursMinutes, formatMoney, type RateSource, ratePill } from "@paypure/domain";
import { Play } from "lucide-react";
import { notFound } from "next/navigation";
import {
  createTask,
  deleteTask,
  toggleTaskDone,
  updateProject,
  updateTask,
} from "@/app/actions/catalog";
import { startTimer } from "@/app/actions/timer";
import { Field, hoursValue, moneyValue } from "@/components/catalog-fields";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/toaster";
import { Empty, PageHeader, Progress, RatePill, StatusChip, Tabs } from "@/components/ui";
import { ApiError, api, getMe } from "@/server/api";

interface Task {
  id: string;
  name: string;
  billingMode: "hourly" | "fixed" | "non_billable";
  estimateSeconds: number | null;
  done: boolean;
  trackedSeconds: number;
  rateMinor?: number | null;
  fixedAmountMinor?: number | null;
  resolvedRateMinor?: number | null;
  rateSource?: RateSource | null;
  unbilledSeconds?: number;
  unbilledMinor?: number;
  fixedBilledMinor?: number;
}

interface ProjectData {
  id: string;
  name: string;
  status: "active" | "completed";
  notes: string;
  budgetKind: "hours" | "money" | null;
  budgetValueHours: number | null;
  client: { id: string; name: string; colour: number; currency: string };
  trackedSeconds: number;
  rateMinor?: number | null;
  budgetValue?: number | null;
  inheritedRate?: { rateMinor: number | null; source: RateSource | null };
  clientRateMinor?: number | null;
  budgetUsed?: number | null;
  unbilledMinor?: number;
  tasks: Task[];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return { title: (await api<ProjectData>(`/v1/projects/${id}`)).name };
  } catch {
    return { title: "Project" };
  }
}

/** Project (S8): Tasks · Details, with the budget card. */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const me = (await getMe())!;
  const { id } = await params;
  const { tab: tabQ } = await searchParams;
  let p: ProjectData;
  try {
    p = await api<ProjectData>(`/v1/projects/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const cur = p.client.currency;
  const money = (minor: number) => formatMoney({ minor, currency: cur });
  const tab = tabQ === "details" && me.isAdmin ? "details" : "tasks";
  const open = p.tasks.filter((t) => !t.done);
  const done = p.tasks.filter((t) => t.done);

  // Rate pill for the project (Guide §5.6)
  let pill: { text: string; tone: "neutral" | "warning" } | null = null;
  if (me.isAdmin) {
    if (p.rateMinor != null) pill = { text: `${money(p.rateMinor)}/h`, tone: "neutral" };
    else
      pill = ratePill(
        "hourly",
        cur,
        p.inheritedRate?.rateMinor != null && p.inheritedRate.source
          ? { rateMinor: p.inheritedRate.rateMinor, source: p.inheritedRate.source }
          : null,
      );
  }

  // Budget (07 §5)
  let budget: { used: number; max: number; text: string } | null = null;
  if (p.budgetKind === "hours" && p.budgetValueHours) {
    budget = {
      used: p.trackedSeconds,
      max: p.budgetValueHours,
      text: `${formatHoursMinutes(p.trackedSeconds)} of ${formatHoursMinutes(p.budgetValueHours)}`,
    };
  } else if (p.budgetKind === "money" && me.isAdmin && p.budgetValue) {
    budget = {
      used: p.budgetUsed ?? 0,
      max: p.budgetValue,
      text: `${money(p.budgetUsed ?? 0)} of ${money(p.budgetValue)}`,
    };
  }

  return (
    <div>
      <PageHeader
        crumbs={[
          { href: "/clients", label: "Clients" },
          { href: `/clients/${p.client.id}?tab=projects`, label: p.client.name },
        ]}
        title={p.name}
        chip={
          <span className="flex items-center gap-2">
            {pill && <RatePill {...pill} />}
            {p.status === "completed" && <StatusChip label="Completed" tone="neutral" />}
          </span>
        }
        actions={
          me.isAdmin ? (
            <>
              <a
                href={`/invoices/new?client=${p.client.id}&project=${p.id}`}
                className="btn btn-secondary"
              >
                Create invoice
              </a>
              <a href="#add-task" className="btn btn-primary">
                Add task
              </a>
            </>
          ) : null
        }
      />

      {budget && (
        <section className="card p-5 mb-6 max-w-[640px]">
          <div className="flex justify-between items-baseline mb-2">
            <h2 className="t-title-3">Budget</h2>
            <span className="tnum">
              {budget.text} ·{" "}
              <span className="font-semibold">{Math.round((budget.used / budget.max) * 100)}%</span>
            </span>
          </div>
          <Progress value={budget.used} max={budget.max} />
        </section>
      )}

      {me.isAdmin && (
        <Tabs
          items={[
            { href: `/projects/${p.id}`, label: "Tasks", current: tab === "tasks" },
            { href: `/projects/${p.id}?tab=details`, label: "Details", current: tab === "details" },
          ]}
        />
      )}

      {tab === "tasks" && (
        <div className="space-y-4">
          {open.length === 0 && done.length === 0 ? (
            <Empty>No tasks yet. Add one below.</Empty>
          ) : (
            <ul className="card divide-y divide-[var(--border)]">
              {open.map((t) => (
                <TaskRow key={t.id} t={t} currency={cur} isAdmin={me.isAdmin} />
              ))}
              {open.length === 0 && <li className="p-4 text-muted">All tasks are done.</li>}
            </ul>
          )}

          {done.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted font-medium">
                {done.length} done
              </summary>
              <ul className="card divide-y divide-[var(--border)] mt-2">
                {done.map((t) => (
                  <TaskRow key={t.id} t={t} currency={cur} isAdmin={me.isAdmin} />
                ))}
              </ul>
            </details>
          )}

          {/* Inline add row: a small real <form>, Enter submits (Guide §7.1) */}
          <ActionForm
            action={createTask}
            reset
            className="flex gap-2 items-center max-w-[640px]"
            id="add-task"
          >
            <input type="hidden" name="projectId" value={p.id} />
            <label htmlFor="new-task" className="sr-only">
              New task name
            </label>
            <input id="new-task" name="name" className="input" placeholder="+ Add task" required />
            <Submit className="btn btn-secondary" pendingText="Adding…">
              Add
            </Submit>
          </ActionForm>
          <p className="hint">
            New tasks bill hourly at the inherited rate. Change it from the task's Edit.
          </p>
        </div>
      )}

      {tab === "details" && me.isAdmin && (
        <ActionForm action={updateProject} className="card p-6 space-y-4 max-w-[640px]">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="currency" value={cur} />
          <Field name="name" label="Name">
            <input id="f-name" name="name" className="input" required defaultValue={p.name} />
          </Field>
          <Field
            name="rate"
            label={`Rate override (${cur}/h)`}
            hint={
              p.clientRateMinor != null
                ? `Empty inherits the client's ${money(p.clientRateMinor)}/h. Unbilled time follows the new rate.`
                : "Empty inherits from the client or the workspace default."
            }
          >
            <input
              id="f-rate"
              name="rate"
              className="input"
              inputMode="decimal"
              defaultValue={moneyValue(p.rateMinor, cur)}
            />
          </Field>
          <fieldset>
            <legend className="label">Budget</legend>
            <div className="flex gap-3 items-start flex-wrap">
              <div className="seg">
                {[
                  ["", "None"],
                  ["hours", "Hours"],
                  ["money", "Amount"],
                ].map(([v, l]) => (
                  <label key={v}>
                    <input
                      type="radio"
                      name="budgetKind"
                      value={v}
                      defaultChecked={(p.budgetKind ?? "") === v}
                    />
                    {l}
                  </label>
                ))}
              </div>
              <div className="w-40">
                <label htmlFor="f-budgetValue" className="sr-only">
                  Budget value
                </label>
                <input
                  id="f-budgetValue"
                  name="budgetValue"
                  className="input"
                  inputMode="decimal"
                  placeholder="Hours or amount"
                  defaultValue={
                    p.budgetKind === "hours"
                      ? hoursValue(p.budgetValueHours)
                      : p.budgetKind === "money"
                        ? moneyValue(p.budgetValue, cur)
                        : ""
                  }
                />
              </div>
            </div>
            <p className="hint">
              Hours count all tracked time. Amount counts billed and unbilled value.
            </p>
          </fieldset>
          <fieldset>
            <legend className="label">Status</legend>
            <div className="seg">
              {[
                ["active", "Active"],
                ["completed", "Completed"],
              ].map(([v, l]) => (
                <label key={v}>
                  <input type="radio" name="status" value={v} defaultChecked={p.status === v} />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
          <Field name="notes" label="Notes">
            <textarea
              id="f-notes"
              name="notes"
              className="textarea"
              rows={3}
              defaultValue={p.notes}
            />
          </Field>
          <Submit pendingText="Saving…">Save</Submit>
        </ActionForm>
      )}
    </div>
  );
}

function taskPill(t: Task, currency: string) {
  if (t.billingMode === "non_billable") return ratePill("non_billable", currency, null);
  if (t.billingMode === "fixed") {
    return ratePill("fixed", currency, null, {
      amountMinor: t.fixedAmountMinor ?? 0,
      billedMinor: t.fixedBilledMinor ?? 0,
    });
  }
  if (t.rateMinor != null)
    return ratePill("hourly", currency, { rateMinor: t.rateMinor, source: "task" });
  return ratePill(
    "hourly",
    currency,
    t.resolvedRateMinor != null && t.rateSource
      ? { rateMinor: t.resolvedRateMinor, source: t.rateSource }
      : null,
  );
}

function TaskRow({ t, currency, isAdmin }: { t: Task; currency: string; isAdmin: boolean }) {
  const money = (minor: number) => formatMoney({ minor, currency });
  const fixedBilled = (t.fixedBilledMinor ?? 0) > 0;
  const effective =
    t.billingMode === "fixed" && t.trackedSeconds > 0 && t.fixedAmountMinor
      ? `${formatHoursMinutes(t.trackedSeconds)} · ${money(Math.round((t.fixedAmountMinor * 3600) / t.trackedSeconds))}/h effective`
      : null;
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <ActionForm action={startTimer} showError={false}>
          <input type="hidden" name="taskId" value={t.id} />
          <button
            type="submit"
            className="btn btn-ghost btn-icon rounded-full"
            aria-label={`Start timer on ${t.name}`}
            title="Start timer"
            disabled={t.done}
          >
            <Play size={14} />
          </button>
        </ActionForm>
        <span
          className={`font-medium flex-1 min-w-[140px] ${t.done ? "text-muted line-through" : ""}`}
        >
          {t.name}
        </span>
        {isAdmin && <RatePill {...taskPill(t, currency)} />}
        <span className="tnum text-muted w-20 text-right">
          {t.trackedSeconds ? formatHoursMinutes(t.trackedSeconds) : "—"}
        </span>
        {t.estimateSeconds ? (
          <span className="w-24" title={`Estimate ${formatHoursMinutes(t.estimateSeconds)}`}>
            <Progress value={t.trackedSeconds} max={t.estimateSeconds} />
          </span>
        ) : (
          <span className="w-24" />
        )}
        {isAdmin && (
          <span className="tnum w-24 text-right">
            {t.unbilledMinor ? money(t.unbilledMinor) : <span className="text-faint">—</span>}
          </span>
        )}
        <details className="menu relative">
          <summary className="btn btn-ghost btn-icon" aria-label={`Actions for ${t.name}`}>
            ⋯
          </summary>
          <div className="menu-body pop right-0 mt-1">
            <a href={`/time?new=1&task=${t.id}`} className="menu-item">
              Log time
            </a>
            <ActionForm action={toggleTaskDone} showError={false}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="done" value={t.done ? "0" : "1"} />
              <button type="submit" className="menu-item">
                {t.done ? "Reopen" : "Mark done"}
              </button>
            </ActionForm>
            {isAdmin && (
              <ActionForm action={deleteTask}>
                <input type="hidden" name="id" value={t.id} />
                <button
                  type="submit"
                  className="menu-item danger"
                  disabled={t.trackedSeconds > 0}
                  title={
                    t.trackedSeconds > 0
                      ? "This task has time entries. Mark it done instead."
                      : undefined
                  }
                >
                  Delete
                </button>
              </ActionForm>
            )}
          </div>
        </details>
      </div>
      {effective && isAdmin && <p className="t-caption ml-11">{effective}</p>}

      {isAdmin && (
        <details className="ml-11 mt-1">
          <summary className="cursor-pointer text-accent text-[13px] font-medium">Edit</summary>
          <ActionForm action={updateTask} className="grid sm:grid-cols-2 gap-4 mt-3 max-w-[640px]">
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="currency" value={currency} />
            <div className="sm:col-span-2">
              <Field id={`f-name-${t.id}`} name="name" label="Name">
                <input
                  id={`f-name-${t.id}`}
                  name="name"
                  className="input"
                  required
                  defaultValue={t.name}
                />
              </Field>
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="label">Billing</legend>
              <div className="seg">
                {(
                  [
                    ["hourly", "Hourly"],
                    ["fixed", "Fixed fee"],
                    ["non_billable", "Non-billable"],
                  ] as const
                ).map(([v, l]) => {
                  // M9: Fixed → Hourly is blocked once part of the fee is billed.
                  const blocked = v === "hourly" && t.billingMode === "fixed" && fixedBilled;
                  return (
                    <label
                      key={v}
                      title={
                        blocked
                          ? "Part of this fee is on an invoice. Add a new hourly task for the extra work."
                          : undefined
                      }
                    >
                      <input
                        type="radio"
                        name="billingMode"
                        value={v}
                        defaultChecked={t.billingMode === v}
                        disabled={blocked}
                      />
                      {l}
                    </label>
                  );
                })}
              </div>
              {fixedBilled && t.billingMode === "fixed" && (
                <p className="hint">
                  {money(t.fixedBilledMinor ?? 0)} of this fee is already billed, so it can't switch
                  to hourly.
                </p>
              )}
            </fieldset>
            <Field
              id={`f-rate-${t.id}`}
              name="rate"
              label={`Hourly rate (${currency}/h)`}
              hint={
                t.billingMode === "hourly" && (t.unbilledSeconds ?? 0) > 0
                  ? `Applies to ${formatHoursMinutes(t.unbilledSeconds ?? 0)} of unbilled time (${money(t.unbilledMinor ?? 0)}).`
                  : "Hourly tasks only. Empty inherits."
              }
            >
              <input
                id={`f-rate-${t.id}`}
                name="rate"
                className="input"
                inputMode="decimal"
                defaultValue={moneyValue(t.rateMinor, currency)}
                placeholder={
                  t.rateMinor == null && t.resolvedRateMinor != null
                    ? `${moneyValue(t.resolvedRateMinor, currency)} from ${t.rateSource}`
                    : "No rate"
                }
              />
            </Field>
            <Field
              id={`f-fixed-${t.id}`}
              name="fixedAmount"
              label={`Fixed fee (${currency})`}
              hint="Fixed-fee tasks only. Time on them is covered by the fee."
            >
              <input
                id={`f-fixed-${t.id}`}
                name="fixedAmount"
                className="input"
                inputMode="decimal"
                defaultValue={moneyValue(t.fixedAmountMinor, currency)}
              />
            </Field>
            <Field id={`f-est-${t.id}`} name="estimate" label="Estimate (hours)">
              <input
                id={`f-est-${t.id}`}
                name="estimate"
                className="input"
                inputMode="decimal"
                defaultValue={hoursValue(t.estimateSeconds)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Submit pendingText="Saving…">Save task</Submit>
            </div>
          </ActionForm>
        </details>
      )}
    </li>
  );
}
