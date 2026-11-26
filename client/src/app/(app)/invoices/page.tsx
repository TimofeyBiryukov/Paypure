import { type ChipTone, daysBetween, formatDateLong, formatMoney, todayIn } from "@paypure/domain";
import { Eye } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoSelect } from "@/components/auto-submit";
import { ClientBadge, Empty, MoneyList, PageHeader, Stat, StatusChip } from "@/components/ui";
import type { Catalog } from "@/lib/types";
import { api, getMe } from "@/server/api";

export const metadata = { title: "Invoices" };

interface Row {
  id: string;
  number: string | null;
  status: "draft" | "issued" | "void";
  rev: number;
  correctionOpen: boolean;
  client: { id: string; name: string; colour: number };
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  totalMinor: number;
  balanceMinor: number;
  display: { label: string; tone: ChipTone; key: string; overpaidMinor?: number };
  viewed: boolean;
}

const TABS = [
  ["all", "All"],
  ["drafts", "Drafts"],
  ["outstanding", "Outstanding"],
  ["overdue", "Overdue"],
  ["paid", "Paid"],
] as const;

function due(d: string | null, today: string, status: string) {
  if (!d || status !== "issued") return <span className="text-faint">—</span>;
  const n = daysBetween(today, d);
  if (n === 0) return "today";
  if (n > 0) return `in ${n} ${n === 1 ? "day" : "days"}`;
  return <span className="text-danger">{-n} {n === -1 ? "day" : "days"} ago</span>;
}

/** Invoices (S10): a sortable table with due date, balance and status chip. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ tab?: string; client?: string; void?: string; sort?: string }> }) {
  const me = (await getMe())!;
  if (!me.isAdmin) redirect("/");
  const sp = await searchParams;
  const tab = sp.tab ?? "outstanding";
  const qs = new URLSearchParams({ tab });
  if (sp.client) qs.set("client", sp.client);
  if (sp.void) qs.set("void", sp.void);
  const [data, catalog] = await Promise.all([
    api<{ invoices: Row[]; counts: Record<string, number>; stats: Record<string, { currency: string; minor: number }[]> }>(`/v1/invoices?${qs}`),
    api<Catalog>("/v1/catalog"),
  ]);
  const today = todayIn(me.workspace.timeZone);
  const sort = sp.sort ?? "";
  const rows = [...data.invoices].sort((a, b) => {
    if (sort === "due") return (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9");
    if (sort === "balance") return b.balanceMinor - a.balanceMinor;
    if (sort === "client") return a.client.name.localeCompare(b.client.name);
    return 0;
  });
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/invoices?${p}`;
  };
  return (
    <div>
      <PageHeader
        title="Invoices"
        actions={
          <details className="menu relative">
            <summary className="btn btn-primary">New invoice</summary>
            <div className="menu-body pop right-0 mt-2 max-h-80 overflow-auto">
              <div className="px-3 py-2 t-caption">Choose a client</div>
              {catalog.clients.map((c) => (
                <Link key={c.id} href={`/invoices/new?client=${c.id}`} className="menu-item">
                  <ClientBadge name={c.name} colour={c.colour} size={20} /> {c.name}
                </Link>
              ))}
            </div>
          </details>
        }
      />
      <nav className="tabs mb-4">
        {TABS.map(([k, label]) => (
          <Link key={k} href={href({ tab: k })} aria-current={tab === k ? "page" : undefined}>
            {label} <span className="text-faint tnum">{data.counts[k] ?? 0}</span>
          </Link>
        ))}
      </nav>
      <form role="search" method="get" action="/invoices" className="flex gap-2 items-center mb-4 flex-wrap">
        <input type="hidden" name="tab" value={tab} />
        <AutoSelect name="client" defaultValue={sp.client ?? ""} className="select h-8 py-0 w-auto" aria-label="Client">
          <option value="">All clients</option>
          {catalog.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </AutoSelect>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="void" value="1" defaultChecked={sp.void === "1"} />
          Show void
        </label>
        <button type="submit" className="btn btn-ghost btn-sm">
          Apply
        </button>
      </form>
      <div className="card grid grid-cols-1 sm:grid-cols-3 gap-6 p-5 mb-6">
        <Stat label="Outstanding" href={href({ tab: "outstanding" })}>
          <MoneyList items={data.stats.outstanding} />
        </Stat>
        <Stat label="Overdue" href={href({ tab: "overdue" })}>
          <MoneyList items={data.stats.overdue} />
        </Stat>
        <Stat label="Paid this month" href={href({ tab: "paid" })}>
          <MoneyList items={data.stats.paidThisMonth} />
        </Stat>
      </div>
      {rows.length === 0 ? (
        <Empty>No invoices here yet. Start from Home → Ready to invoice.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>
                  <Link href={href({ sort: "client" })}>Client{sort === "client" ? " ▲" : ""}</Link>
                </th>
                <th>Issued</th>
                <th>
                  <Link href={href({ sort: "due" })}>Due{sort === "due" ? " ▲" : ""}</Link>
                </th>
                <th className="num">Total</th>
                <th className="num">
                  <Link href={href({ sort: "balance" })}>Balance{sort === "balance" ? " ▼" : ""}</Link>
                </th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Viewed</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td className="font-semibold tnum whitespace-nowrap">
                    <Link href={`/invoices/${i.id}`} className={i.status === "void" ? "line-through text-faint" : "hover:text-accent"}>
                      {i.number ?? "Draft"}
                    </Link>
                    {i.rev > 1 && <span className="t-caption ml-1">rev {i.rev}</span>}
                  </td>
                  <td>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <ClientBadge name={i.client.name} colour={i.client.colour} size={20} /> {i.client.name}
                    </span>
                  </td>
                  <td className="text-muted whitespace-nowrap">{i.issueDate ? formatDateLong(i.issueDate) : "—"}</td>
                  <td className="whitespace-nowrap">{due(i.dueDate, today, i.status)}</td>
                  <td className="num">{formatMoney({ minor: i.totalMinor, currency: i.currency })}</td>
                  <td className="num font-semibold">{i.status === "issued" ? formatMoney({ minor: Math.max(0, i.balanceMinor), currency: i.currency }) : <span className="text-faint">—</span>}</td>
                  <td>
                    <StatusChip label={i.display.label} tone={i.display.tone} note={i.display.overpaidMinor ? `overpaid ${formatMoney({ minor: i.display.overpaidMinor, currency: i.currency })}` : i.correctionOpen ? "correction open" : undefined} />
                  </td>
                  <td>{i.viewed && <Eye size={14} className="text-muted" aria-label="Viewed by client" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
