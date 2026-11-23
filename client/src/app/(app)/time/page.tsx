import { addDays, formatDateShort, formatDuration, formatHoursMinutes, formatMoney, startOfWeek, sumByCurrency, todayIn, toLocalTime } from "@paypure/domain";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { bulkTime } from "@/app/actions/time";
import { AutoSelect } from "@/components/auto-submit";
import { EntryLine } from "@/components/entry-line";
import { EntryPanel } from "@/components/entry-panel";
import { Submit } from "@/components/submit";
import { TaskPicker } from "@/components/task-picker";
import { ActionForm } from "@/components/toaster";
import { Empty, MoneyList, PageHeader, Stat } from "@/components/ui";
import { computeGaps, type EntryRow } from "@/lib/time";
import type { Catalog } from "@/lib/types";
import { api, getMe } from "@/server/api";

export const metadata = { title: "Time" };

type SP = Record<string, string | undefined>;

/** Time (S2): see, fix and fill your time. The Maker's main screen. URL is state (Guide §6). */
export default async function TimePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = (await getMe())!;
  const tz = me.tz;
  const today = todayIn(tz);
  const view = sp.view === "day" ? "day" : sp.view === "list" ? "list" : "week";
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const weekStart = startOfWeek(date, me.member.weekStart);
  const from = view === "list" ? (sp.from ?? addDays(today, -90)) : view === "day" ? date : weekStart;
  const to = view === "list" ? (sp.to ?? today) : view === "day" ? date : addDays(weekStart, 6);
  const qs = new URLSearchParams({ from, to });
  for (const k of ["member", "client", "state", "invoice"]) if (sp[k]) qs.set(k, sp[k] as string);
  const [entries, catalog, members] = await Promise.all([
    api<EntryRow[]>(`/v1/time-entries?${qs}`),
    api<Catalog>("/v1/catalog"),
    me.isAdmin ? api<{ id: string; name: string; status: string }[]>("/v1/settings/members") : Promise.resolve([]),
  ]);

  const link = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    for (const k of ["edit", "new"]) if (!(k in patch)) p.delete(k);
    return `/time?${p}`;
  };
  const step = view === "day" ? 1 : 7;
  const days =
    view === "list"
      ? [...new Set(entries.map((e) => e.date))].sort().reverse()
      : view === "day"
        ? [date]
        : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => d <= today || entries.some((e) => e.date === d)).reverse();
  const byDay = (d: string) => entries.filter((e) => e.date === d);
  const total = entries.reduce((s, e) => s + e.durationSeconds, 0);
  const billable = entries.filter((e) => e.billable && e.task?.billingMode === "hourly").reduce((s, e) => s + e.durationSeconds, 0);
  const unbilled = sumByCurrency(
    entries.filter((e) => !e.invoice && !e.offInvoice && e.valueMinor && e.task && e.state === "stopped").map((e) => ({ minor: e.valueMinor as number, currency: e.task?.currency as string })),
  );
  const edit = sp.edit ? entries.find((e) => e.id === sp.edit) ?? (await api<EntryRow[]>(`/v1/time-entries?from=2000-01-01&to=2100-01-01&member=all`).then((xs) => xs.find((x) => x.id === sp.edit) ?? null).catch(() => null)) : null;
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const maxDay = Math.max(1, ...weekDays.map((d) => byDay(d).reduce((s, e) => s + e.durationSeconds, 0)));
  const filtersActive = !!(sp.client || sp.state || sp.member || sp.invoice);

  return (
    <div>
      <PageHeader
        title="Time"
        actions={
          <>
            <div className="seg">
              <Link href={link({ view: "week" })} aria-current={view === "week" ? "page" : undefined}>
                Week
              </Link>
              <Link href={link({ view: "day" })} aria-current={view === "day" ? "page" : undefined}>
                Day
              </Link>
            </div>
            <Link href={link({ new: "1" })} className="btn btn-primary" scroll={false}>
              Add entry
            </Link>
          </>
        }
      />

      {view !== "list" && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Link href={link({ date: addDays(date, -step) })} className="btn btn-secondary btn-icon" aria-label="Previous">
            <ChevronLeft size={16} />
          </Link>
          <Link href={link({ date: addDays(date, step) })} className="btn btn-secondary btn-icon" aria-label="Next">
            <ChevronRight size={16} />
          </Link>
          <span className="t-title-3 px-2">
            {view === "day" ? formatDateShort(date) : `${formatDateShort(weekStart)} – ${formatDateShort(addDays(weekStart, 6))}`}
          </span>
          <Link href={link({ date: undefined })} className="btn btn-ghost btn-sm">
            Today
          </Link>
          <form method="get" action="/time" className="flex items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <label className="sr-only" htmlFor="jump-date">
              Go to date
            </label>
            <input id="jump-date" type="date" name="date" defaultValue={date} className="input h-8 py-0 w-[150px]" />
            <button type="submit" className="btn btn-ghost btn-sm">
              Go
            </button>
          </form>
        </div>
      )}

      {/* Filters: a GET search form; selects submit on change (Guide §7.1) */}
      <form role="search" method="get" action="/time" className="flex flex-wrap items-center gap-2 mb-4">
        <input type="hidden" name="view" value={view} />
        {sp.date && <input type="hidden" name="date" value={sp.date} />}
        {view === "list" && <input type="hidden" name="from" value={from} />}
        {view === "list" && <input type="hidden" name="to" value={to} />}
        {me.isAdmin && (
          <AutoSelect name="member" defaultValue={sp.member ?? ""} className="select h-8 py-0 w-auto" aria-label="Member">
            <option value="">Me</option>
            <option value="all">Everyone</option>
            {members.filter((m) => m.id !== me.member.id).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </AutoSelect>
        )}
        <AutoSelect name="client" defaultValue={sp.client ?? ""} className="select h-8 py-0 w-auto" aria-label="Client">
          <option value="">All clients</option>
          {catalog.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </AutoSelect>
        <AutoSelect name="state" defaultValue={sp.state ?? ""} className="select h-8 py-0 w-auto" aria-label="Invoice state">
          <option value="">Invoice state: any</option>
          <option value="unbilled">Unbilled</option>
          <option value="billed">Billed</option>
          <option value="billed_elsewhere">Billed elsewhere</option>
          <option value="written_off">Written off</option>
        </AutoSelect>
        {sp.invoice && (
          <Link href={link({ invoice: undefined })} className="chip chip-info plain">
            On one invoice ✕
          </Link>
        )}
        <noscript>
          <button type="submit" className="btn btn-secondary btn-sm">
            Apply
          </button>
        </noscript>
        {filtersActive && (
          <Link href={`/time?view=${view}`} className="btn btn-ghost btn-sm">
            Clear filters
          </Link>
        )}
      </form>

      <div className="card grid grid-cols-2 sm:grid-cols-4 gap-6 p-5 mb-6">
        <Stat label="Total">{formatHoursMinutes(total)}</Stat>
        <Stat label="Billable">{formatHoursMinutes(billable)}</Stat>
        <Stat label="Non-billable">{formatHoursMinutes(total - billable)}</Stat>
        {me.isAdmin && (
          <Stat label="Unbilled value">
            <MoneyList items={unbilled} />
          </Stat>
        )}
      </div>

      {view === "week" && (
        <div className="card p-5 mb-6 hidden sm:block">
          <div className="flex items-end gap-3 h-28">
            {weekDays.map((d) => {
              const es = byDay(d);
              const secs = es.reduce((s, e) => s + e.durationSeconds, 0);
              const clients = new Map<number, number>();
              for (const e of es) clients.set(e.task?.colour ?? 6, (clients.get(e.task?.colour ?? 6) ?? 0) + e.durationSeconds);
              return (
                <Link key={d} href={link({ view: "day", date: d })} className="flex-1 flex flex-col items-center gap-1" title={`${formatDateShort(d)} · ${formatHoursMinutes(secs)}`}>
                  <span className="t-caption tnum">{secs ? formatHoursMinutes(secs) : ""}</span>
                  <div className="w-full flex flex-col-reverse rounded-sm overflow-hidden" style={{ height: `${(secs / maxDay) * 72}px` }}>
                    {[...clients.entries()].map(([c, s]) => (
                      <span key={c} style={{ flex: s, background: `var(--c${c % 10})` }} />
                    ))}
                  </div>
                  <span className={`t-caption ${d === today ? "text-ink font-semibold" : ""}`}>{formatDateShort(d).slice(0, 3)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {entries.length === 0 && days.every((d) => byDay(d).length === 0) ? (
        <Empty action={<Link href={link({ new: "1" })} className="btn btn-primary">Add entry</Link>}>
          {view === "week" ? "No time tracked this week." : view === "day" ? "No time tracked on this day." : "No entries match these filters."}
        </Empty>
      ) : (
        <div className="space-y-6">
          {days.map((d) => {
            const es = byDay(d);
            const timed = es.filter((e) => e.startedAt);
            const untimed = es.filter((e) => !e.startedAt);
            const gaps = d <= today ? computeGaps(timed) : [];
            const rows = [
              ...timed.map((e) => ({ at: e.startedAt as string, e })),
              ...gaps.map((g) => ({ at: g.from, g })),
            ].sort((a, b) => a.at.localeCompare(b.at));
            return (
              <section key={d}>
                <h2 className="sticky top-14 z-10 bg-bg py-2 flex items-baseline justify-between border-b border-line">
                  <span className="t-title-3">{d === today ? `Today · ${formatDateShort(d)}` : formatDateShort(d)}</span>
                  <span className="tnum font-semibold">{formatHoursMinutes(es.reduce((s, e) => s + e.durationSeconds, 0))}</span>
                </h2>
                <ul className="divide-y divide-[var(--border)]">
                  {rows.map((r) =>
                    "e" in r && r.e ? (
                      <li key={r.e.id}>
                        <EntryLine e={r.e} tz={tz} isAdmin={me.isAdmin} selectable editHref={link({ edit: r.e.id, date: view === "list" ? sp.date : sp.date })} />
                      </li>
                    ) : "g" in r && r.g ? (
                      <li key={`gap-${r.g.from}`} className="py-2">
                        <Link scroll={false} href={link({ new: "1", date: d, start: r.g.from, end: r.g.to })} className="gap-row flex items-center justify-between px-3 py-2 hover:bg-sunken">
                          <span className="tnum">
                            {toLocalTime(r.g.from, tz)}–{toLocalTime(r.g.to, tz)} · {formatDuration(r.g.seconds)} not tracked
                          </span>
                          <span className="text-accent font-medium">+ Fill</span>
                        </Link>
                      </li>
                    ) : null,
                  )}
                  {untimed.length > 0 && <li className="pt-3 t-caption">No time of day</li>}
                  {untimed.map((e) => (
                    <li key={e.id}>
                      <EntryLine e={e} tz={tz} isAdmin={me.isAdmin} selectable editHref={link({ edit: e.id })} />
                    </li>
                  ))}
                </ul>
                <Link scroll={false} href={link({ new: "1", date: d })} className="inline-block mt-2 text-accent font-medium text-sm">
                  + Add entry for {formatDateShort(d).slice(0, 3)}
                </Link>
              </section>
            );
          })}
        </div>
      )}

      {/* Bulk bar: appears when entries are selected (pure CSS :has, no JS needed) */}
      <style>{`.bulk-bar{display:none}body:has(input[name="entryIds"]:checked) .bulk-bar{display:flex}`}</style>
      <ActionForm action={bulkTime} id="bulk-form" className="bulk-bar fixed bottom-16 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 pop px-3 py-2 items-center gap-1 flex-wrap max-w-[calc(100vw-24px)]">
        <span className="px-2 font-medium">Selected</span>
        <button type="submit" name="op" value="billable" className="btn btn-ghost btn-sm">
          Mark billable
        </button>
        <button type="submit" name="op" value="non_billable" className="btn btn-ghost btn-sm">
          Mark non-billable
        </button>
        <details className="menu relative">
          <summary className="btn btn-ghost btn-sm">Move to task…</summary>
          <div className="menu-body pop bottom-full mb-2 w-80 p-3 space-y-2">
            <TaskPicker tasks={catalog.tasks} recent={catalog.recentTaskIds} label="Move to" />
            <button type="submit" name="op" value="move" className="btn btn-primary btn-sm">
              Move
            </button>
          </div>
        </details>
        {me.isAdmin && (
          <details className="menu relative">
            <summary className="btn btn-ghost btn-sm">Take off unbilled…</summary>
            <div className="menu-body pop bottom-full mb-2 w-80 p-3 space-y-2">
              <p className="text-sm text-muted">The time stays in your history and leaves every unbilled total. You can restore it later.</p>
              <button type="submit" name="op" value="written_off" className="btn btn-secondary btn-sm w-full">
                Written off
              </button>
              <label className="label" htmlFor="off-ref">
                Reference (for billed elsewhere)
              </label>
              <input id="off-ref" name="ref" className="input" placeholder="e.g. Paydirt #142" />
              <button type="submit" name="op" value="billed_elsewhere" className="btn btn-secondary btn-sm w-full">
                Billed elsewhere
              </button>
              <button type="submit" name="op" value="restore_unbilled" className="btn btn-ghost btn-sm w-full">
                Restore to unbilled
              </button>
            </div>
          </details>
        )}
        <button type="submit" name="op" value="delete" className="btn btn-ghost btn-sm text-danger">
          Delete
        </button>
      </ActionForm>

      {(sp.new || edit) && (
        <EntryPanel
          key={edit?.id ?? `new-${sp.start ?? ""}`}
          entry={edit ?? null}
          catalog={catalog}
          tz={tz}
          date={sp.new && sp.date ? sp.date : date}
          isAdmin={me.isAdmin}
          members={members.filter((m) => m.status === "active" && m.id !== me.member.id)}
          defaults={{ taskId: sp.task, start: sp.start, end: sp.end }}
        />
      )}
      {me.isAdmin && unbilled.length > 0 && view === "list" && (
        <p className="t-caption mt-6">Values use the current rates: {unbilled.map((u) => formatMoney(u)).join(" · ")}.</p>
      )}
    </div>
  );
}
