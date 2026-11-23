import { formatHoursMinutes } from "@paypure/domain";
import Link from "next/link";
import { ClientBadge, Empty, Money, MoneyList, PageHeader, Tabs } from "@/components/ui";
import { api, getMe } from "@/server/api";

export const metadata = { title: "Clients" };

interface ClientRow {
  id: string;
  name: string;
  colour: number;
  currency: string;
  activeProjects: number;
  secondsThisMonth: number;
  archived: boolean;
  unbilledMinor?: number;
  outstandingMinor?: number;
  overdueMinor?: number;
}

type M = { currency: string; minor: number };

/** Clients (S5): every client and its money position. */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ archived?: string; q?: string }> }) {
  const me = (await getMe())!;
  const { archived, q = "" } = await searchParams;
  const showArchived = archived === "1";
  const data = await api<{ clients: ClientRow[]; totals?: { unbilled: M[]; outstanding: M[]; overdue: M[] } }>(
    `/v1/clients${showArchived ? "?archived=1" : ""}`,
  );
  const query = q.trim().toLowerCase();
  const rows = data.clients.filter((c) => !query || c.name.toLowerCase().includes(query));
  // Footer totals recalculate with the search instead of hiding (⟵ PD).
  const sum = (pick: (c: ClientRow) => number | undefined): M[] => {
    const m = new Map<string, number>();
    for (const c of rows) m.set(c.currency, (m.get(c.currency) ?? 0) + (pick(c) ?? 0));
    return [...m.entries()].map(([currency, minor]) => ({ currency, minor }));
  };
  const money = me.isAdmin;

  return (
    <div>
      <PageHeader
        title="Clients"
        actions={
          me.isAdmin ? (
            <Link href="/clients/new" className="btn btn-primary">
              New client
            </Link>
          ) : null
        }
      />
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <Tabs
          items={[
            { href: "/clients", label: "Active", current: !showArchived },
            { href: "/clients?archived=1", label: "Archived", current: showArchived },
          ]}
        />
        <form role="search" method="get" action="/clients" className="mb-6 flex gap-2">
          {showArchived && <input type="hidden" name="archived" value="1" />}
          <label htmlFor="client-q" className="sr-only">
            Search clients
          </label>
          <input id="client-q" name="q" type="search" defaultValue={q} placeholder="Search clients" className="input w-56" />
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        data.clients.length === 0 && !showArchived ? (
          <Empty
            action={
              me.isAdmin ? (
                <Link href="/clients/new" className="btn btn-primary">
                  New client
                </Link>
              ) : null
            }
          >
            Add your first client to start tracking time for them.
          </Empty>
        ) : (
          <Empty>{query ? `No client matches “${q}”.` : "No archived clients."}</Empty>
        )
      ) : (
        <>
          <div className="card overflow-x-auto hidden sm:block">
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="num">Active projects</th>
                  <th className="num">Hours this month</th>
                  {money && (
                    <>
                      <th className="num">Unbilled</th>
                      <th className="num">Outstanding</th>
                      <th className="num">Overdue</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/clients/${c.id}`} className="flex items-center gap-2 font-semibold hover:text-accent">
                        <ClientBadge name={c.name} colour={c.colour} /> {c.name}
                      </Link>
                    </td>
                    <td className="num">{c.activeProjects || <span className="text-faint">—</span>}</td>
                    <td className="num">{c.secondsThisMonth ? formatHoursMinutes(c.secondsThisMonth) : <span className="text-faint">—</span>}</td>
                    {money && (
                      <>
                        <td className="num">
                          <Money m={{ minor: c.unbilledMinor ?? 0, currency: c.currency }} dash />
                        </td>
                        <td className="num">
                          <Money m={{ minor: c.outstandingMinor ?? 0, currency: c.currency }} dash />
                        </td>
                        <td className="num" style={c.overdueMinor ? { color: "var(--danger-fg)" } : undefined}>
                          <Money m={{ minor: c.overdueMinor ?? 0, currency: c.currency }} dash />
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              {money && (
                <tfoot>
                  <tr className="border-t border-line">
                    <td className="font-medium p-3" colSpan={3}>
                      Total
                    </td>
                    <td className="num p-3 font-semibold">
                      <MoneyList items={sum((c) => c.unbilledMinor)} empty="—" />
                    </td>
                    <td className="num p-3 font-semibold">
                      <MoneyList items={sum((c) => c.outstandingMinor)} empty="—" />
                    </td>
                    <td className="num p-3 font-semibold">
                      <MoneyList items={sum((c) => c.overdueMinor)} empty="—" />
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {/* ⓜ cards: badge, name, unbilled, overdue chip */}
          <ul className="sm:hidden space-y-2">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/clients/${c.id}`} className="card flex items-center gap-3 p-4">
                  <ClientBadge name={c.name} colour={c.colour} size={32} />
                  <span className="flex-1 font-semibold truncate">{c.name}</span>
                  {money && (
                    <span className="text-right">
                      <Money m={{ minor: c.unbilledMinor ?? 0, currency: c.currency }} dash />
                      {(c.overdueMinor ?? 0) > 0 && <span className="chip chip-danger block mt-1">Overdue</span>}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
