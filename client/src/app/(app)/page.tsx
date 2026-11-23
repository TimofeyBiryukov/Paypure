import { addDays, formatDateLong, formatDateRelative, formatDateShort, formatDuration, formatHoursMinutes, formatMoney, todayIn, toLocalTime } from "@paypure/domain";
import Link from "next/link";
import { EntryLine } from "@/components/entry-line";
import { ClientBadge, Empty, MoneyList, Stat, StatusChip } from "@/components/ui";
import { computeGaps, type EntryRow } from "@/lib/time";
import { api, getMe } from "@/server/api";

export const metadata = { title: "Home" };

interface HomeData {
  today: string;
  days: { date: string; seconds: number; clients: { name: string; colour: number; seconds: number }[] }[];
  thisWeekSeconds: number;
  lastWeekSeconds: number;
  firstRun: boolean;
  memberHasTasks: boolean;
  checklist: { business: boolean; client: boolean; time: boolean };
  ready?: { clientId: string; name: string; colour: number; currency: string; seconds: number; amountMinor: number; noRateSeconds: number; since: string | null; ready: boolean; stale: boolean }[];
  outstanding?: {
    outstanding: { currency: string; minor: number }[];
    overdue: { currency: string; minor: number }[];
    paidThisMonth: { currency: string; minor: number }[];
    top: { id: string; number: string | null; client: { name: string; colour: number }; balanceMinor: number; currency: string; dueDate: string | null; display: { label: string; tone: "danger" } }[];
  };
}

/** Home (S1): answers "what should I do now?" for both personas. */
export default async function HomePage() {
  const me = (await getMe())!;
  const tz = me.tz;
  const today = todayIn(tz);
  const [home, entries] = await Promise.all([
    api<HomeData>("/v1/home"),
    api<EntryRow[]>(`/v1/time-entries?from=${today}&to=${today}`),
  ]);
  const hour = Number(toLocalTime(new Date().toISOString(), tz).slice(0, 2));
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const todaySecs = entries.reduce((s, e) => s + e.durationSeconds, 0);
  const gaps = computeGaps(entries.filter((e) => e.state === "stopped"));
  const max = Math.max(1, ...home.days.map((d) => d.seconds));
  const diff = home.thisWeekSeconds - home.lastWeekSeconds;

  if (home.firstRun && me.isAdmin) {
    return (
      <div className="max-w-[640px]">
        <h1 className="t-title-1 mb-2">Welcome to Paypure</h1>
        <p className="text-muted mb-6">Three steps and you're tracking.</p>
        <ol className="card divide-y divide-[var(--border)]">
          {[
            { done: home.checklist.business, label: "Add your business details", href: "/settings/business" },
            { done: home.checklist.client, label: "Add a client", href: "/clients/new" },
            { done: home.checklist.time, label: "Track your first hour", href: "/time" },
          ].map((s, i) => (
            <li key={s.label} className="flex items-center gap-3 p-4">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center t-micro ${s.done ? "chip-success" : "bg-sunken"}`}>{s.done ? "✓" : i + 1}</span>
              <Link href={s.href} className="font-medium hover:text-accent">
                {s.label}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-title-1">
            {greet}, {me.member.name.split(" ")[0]}
          </h1>
          <p className="text-muted">{formatDateLong(today)}</p>
        </div>
      </header>

      {!me.isAdmin && !home.memberHasTasks && <Empty>Ask an admin to add you to a project.</Empty>}

      <div className="grid lg:grid-cols-[1fr_380px] gap-6">
        <section className="card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="t-title-2">Today</h2>
            <div className="flex items-baseline gap-3">
              <span className="t-figure">{formatHoursMinutes(todaySecs)}</span>
              <Link href="/time?view=day" className="text-accent font-medium">
                Open day
              </Link>
            </div>
          </div>
          {entries.length === 0 ? (
            <Empty>Nothing tracked yet today.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {entries.map((e) => (
                <li key={e.id}>
                  <EntryLine e={e} tz={tz} isAdmin={me.isAdmin} compact />
                </li>
              ))}
              {gaps.map((g) => (
                <li key={g.from} className="py-2">
                  <Link href={`/time?view=day&date=${today}&new=1&start=${encodeURIComponent(g.from)}&end=${encodeURIComponent(g.to)}`} className="gap-row flex items-center justify-between px-3 py-2 hover:bg-sunken">
                    <span className="tnum">
                      {toLocalTime(g.from, tz)}–{toLocalTime(g.to, tz)} · {formatDuration(g.seconds)} not tracked
                    </span>
                    <span className="text-accent font-medium">+ Fill</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5 hidden sm:block">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="t-title-2">This week</h2>
            <span className="tnum">
              <span className="font-semibold">{formatHoursMinutes(home.thisWeekSeconds)}</span>
              <span className="text-muted"> · {diff >= 0 ? "+" : "−"}{formatHoursMinutes(Math.abs(diff))}</span>
            </span>
          </div>
          <div className="flex items-end gap-2 h-36" role="img" aria-label={`Hours this week: ${home.days.map((d) => `${formatDateShort(d.date)} ${formatHoursMinutes(d.seconds)}`).join(", ")}`}>
            {home.days.map((d) => (
              <Link key={d.date} href={`/time?view=day&date=${d.date}`} className="flex-1 flex flex-col items-center gap-1 group" title={`${formatDateShort(d.date)} · ${formatHoursMinutes(d.seconds)}`}>
                <div className="w-full flex flex-col-reverse rounded-sm overflow-hidden" style={{ height: `${(d.seconds / max) * 112}px`, minHeight: d.seconds ? 2 : 0 }}>
                  {d.clients.map((c) => (
                    <span key={c.name} style={{ flex: c.seconds, background: `var(--c${c.colour % 10})` }} />
                  ))}
                </div>
                <span className={`t-caption ${d.date === today ? "text-ink font-semibold" : ""}`}>{formatDateShort(d.date).slice(0, 3)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {me.isAdmin && home.ready && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="t-title-2">Ready to invoice</h2>
          </div>
          {home.ready.length === 0 ? (
            <Empty>No unbilled work. Nice.</Empty>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <tbody>
                  {home.ready.map((r) => (
                    <tr key={r.clientId}>
                      <td>
                        <Link href={`/clients/${r.clientId}`} className="flex items-center gap-2 font-semibold">
                          <ClientBadge name={r.name} colour={r.colour} /> {r.name}
                        </Link>
                      </td>
                      <td className="num text-muted">{formatHoursMinutes(r.seconds)}</td>
                      <td className="num font-semibold">
                        {r.noRateSeconds > 0 && r.amountMinor === 0 ? (
                          <Link href={`/clients/${r.clientId}?tab=details`} className="text-warning">
                            Set a rate
                          </Link>
                        ) : (
                          formatMoney({ minor: r.amountMinor, currency: r.currency })
                        )}
                      </td>
                      <td className="text-muted whitespace-nowrap">{r.since ? `since ${formatDateRelative(r.since, today)}` : ""}</td>
                      <td className="whitespace-nowrap">
                        {r.ready && <span className="chip chip-info plain mr-2">Ready</span>}
                        {r.stale && (
                          <>
                            <span className="chip chip-warning plain mr-2">Stale</span>
                            <Link href={`/time?client=${r.clientId}&state=unbilled&from=2000-01-01&to=${addDays(today, -60)}&view=list`} className="text-accent font-medium">
                              Review
                            </Link>
                          </>
                        )}
                      </td>
                      <td className="text-right">
                        <Link href={`/invoices/new?client=${r.clientId}`} className="btn btn-secondary btn-sm">
                          Create invoice
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {me.isAdmin && home.outstanding && (
        <section className="space-y-3">
          <h2 className="t-title-2">Outstanding</h2>
          <div className="card grid grid-cols-2 sm:grid-cols-3 gap-6 p-5">
            <Stat label="Outstanding" href="/invoices?tab=outstanding">
              <MoneyList items={home.outstanding.outstanding} />
            </Stat>
            <Stat label="Overdue" href="/invoices?tab=overdue">
              <MoneyList items={home.outstanding.overdue} />
            </Stat>
            <Stat label="Paid this month" href="/invoices?tab=paid">
              <MoneyList items={home.outstanding.paidThisMonth} />
            </Stat>
          </div>
          {home.outstanding.top.length > 0 && (
            <div className="card">
              <table className="table">
                <tbody>
                  {home.outstanding.top.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/invoices/${i.id}`} className="font-semibold tnum">
                          {i.number}
                        </Link>
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <ClientBadge name={i.client.name} colour={i.client.colour} size={20} /> {i.client.name}
                        </span>
                      </td>
                      <td className="num">{formatMoney({ minor: i.balanceMinor, currency: i.currency })}</td>
                      <td className="text-right">
                        <StatusChip label={i.display.label} tone={i.display.tone} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
