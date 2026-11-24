import { type ChipTone, formatMoney, type Money as M } from "@paypure/domain";
import { NoteMarkdown } from "./note-md";
import Link from "next/link";

export function StatusChip({ label, tone, note }: { label: string; tone: ChipTone; note?: string }) {
  return (
    <span className={`chip chip-${tone}`}>
      {label}
      {note ? <span className="font-medium opacity-80"> · {note}</span> : null}
    </span>
  );
}

export function ClientBadge({ name, colour, size = 24 }: { name: string; colour: number; size?: number }) {
  const mono = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className="badge"
      style={{ width: size, height: size, background: `var(--c${colour % 10})`, fontSize: size >= 32 ? 13 : 10 }}
      aria-hidden="true"
    >
      {mono}
    </span>
  );
}

/** Zero shows as — in tables (Guide §5.7). */
export function Money({ m, dash = false, code = false }: { m: M; dash?: boolean; code?: boolean }) {
  if (dash && m.minor === 0) return <span className="text-faint">—</span>;
  return <span className="tnum">{formatMoney(m, { withCode: code })}</span>;
}

/** One row per currency, never summed across currencies. */
export function MoneyList({ items, empty = "0" }: { items: M[]; empty?: string }) {
  const nonZero = items.filter((i) => i.minor !== 0);
  if (nonZero.length === 0) return <span className="text-faint">{empty}</span>;
  const mixed = nonZero.length > 1;
  return (
    <span className="flex flex-col">
      {nonZero.map((m) => (
        <span key={m.currency} className="tnum">
          {formatMoney(m, { withCode: mixed })}
        </span>
      ))}
    </span>
  );
}

export function Stat({ label, children, href }: { label: string; children: React.ReactNode; href?: string }) {
  const inner = (
    <>
      <div className="t-caption">{label}</div>
      <div className="t-figure mt-1">{children}</div>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-md hover:bg-sunken -m-2 p-2">
      {inner}
    </Link>
  ) : (
    <div>{inner}</div>
  );
}

export function StatStrip({ children }: { children: React.ReactNode }) {
  return <div className="card grid grid-cols-2 sm:grid-cols-4 gap-6 p-5">{children}</div>;
}

export function PageHeader({
  title,
  crumbs,
  actions,
  chip,
  sub,
}: {
  title: React.ReactNode;
  crumbs?: { href: string; label: string }[];
  actions?: React.ReactNode;
  chip?: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-6 mb-6">
      <div className="min-w-0 flex-1">
        {crumbs && (
          <nav className="t-caption mb-1" aria-label="Breadcrumb">
            {crumbs.map((c) => (
              <span key={c.href}>
                <Link href={c.href} className="hover:text-ink">
                  {c.label}
                </Link>{" "}
                /{" "}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="t-title-1 truncate">{title}</h1>
          {chip}
        </div>
        {sub && <div className="text-muted mt-1">{sub}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}

export function Tabs({ items }: { items: { href: string; label: React.ReactNode; current: boolean }[] }) {
  return (
    <nav className="tabs mb-6">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="well flex flex-col items-center gap-3">
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Light Markdown subset for notes (Guide §5.13). */
export function Note({ text, className = "" }: { text: string; className?: string }) {
  return <NoteMarkdown text={text} className={className} />;
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const cls = pct > 100 ? "over" : pct >= 80 ? "warn" : "";
  return (
    <div className={`progress ${cls}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

/** Rate pill (Guide §5.6). */
export function RatePill({ text, tone }: { text: string; tone: "neutral" | "warning" }) {
  return <span className={`pill ${tone === "warning" ? "pill-warning" : ""}`}>{text}</span>;
}
