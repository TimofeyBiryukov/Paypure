import { formatDuration, formatMoney, noteExtraLines, noteFirstLine } from "@paypure/domain";
import { Lock } from "lucide-react";
import Link from "next/link";
import { type EntryRow, entryRange } from "@/lib/time";
import { NoteInline } from "./note-md";
import { ClientBadge, Note } from "./ui";

/** Time entry row (Guide §5.10). */
export function EntryLine({
  e,
  tz,
  isAdmin,
  compact,
  editHref,
  selectable,
}: {
  e: EntryRow;
  tz: string;
  isAdmin: boolean;
  compact?: boolean;
  editHref?: string;
  selectable?: boolean;
}) {
  const breaks = Math.max(0, e.segments.length - 1);
  const firstLine = noteFirstLine(e.note);
  const more = noteExtraLines(e.note);
  const billedIssued = e.invoice?.status === "issued";
  const href = editHref ?? `/time?view=day&date=${e.date}&edit=${e.id}`;
  return (
    <div className={`flex gap-3 ${compact ? "py-2" : "py-3"} items-start`}>
      {selectable && (
        <input
          type="checkbox"
          name="entryIds"
          value={e.id}
          form="bulk-form"
          className="mt-1.5"
          aria-label={`Select entry ${e.task?.name ?? ""}`}
          disabled={e.state !== "stopped" || billedIssued}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          {e.task ? <ClientBadge name={e.task.clientName} colour={e.task.colour} size={20} /> : <span className="w-5" />}
          <Link href={href} className="truncate hover:text-accent" scroll={false}>
            {e.task ? (
              <>
                <span className="text-muted">
                  {e.task.clientName} / {e.task.projectName} ›{" "}
                </span>
                <span className="font-medium">{e.task.name}</span>
              </>
            ) : (
              <span className="text-warning font-medium">Choose task…</span>
            )}
          </Link>
          {e.state !== "stopped" && <span className={`chip chip-info ${e.state === "running" ? "" : "plain"}`}>{e.state === "running" ? "Running" : "Paused"}</span>}
        </div>
        {!compact && firstLine && (
          <details className="mt-0.5 text-muted group">
            <summary className="list-none cursor-pointer truncate">
              <NoteInline text={firstLine} />
              {more > 0 && <span className="text-accent ml-2 group-open:hidden">+{more} lines</span>}
            </summary>
            {more > 0 && <Note text={e.note} className="mt-1" />}
          </details>
        )}
        {compact && firstLine && <div className="text-muted truncate mt-0.5"><NoteInline text={firstLine} /></div>}
      </div>
      <div className="text-right shrink-0">
        <div className="flex items-center gap-2 justify-end">
          <span className="text-muted tnum text-[13px] hidden sm:inline">{entryRange(e, tz)}</span>
          {breaks > 0 && (
            <span className="t-caption" title={`${breaks} ${breaks === 1 ? "break" : "breaks"}`}>
              ‖ {breaks}
            </span>
          )}
          <span className="font-semibold tnum w-12 text-right">{formatDuration(e.durationSeconds)}</span>
        </div>
        <div className="flex items-center gap-2 justify-end mt-0.5 text-[12px]">
          {isAdmin && e.valueMinor != null && e.task && !e.invoice && !e.offInvoice && (
            <span className="text-muted tnum">{formatMoney({ minor: e.valueMinor, currency: e.task.currency })}</span>
          )}
          <EntryTag e={e} isAdmin={isAdmin} />
        </div>
      </div>
    </div>
  );
}

export function EntryTag({ e, isAdmin }: { e: EntryRow; isAdmin: boolean }) {
  if (e.changePending) return <span className="chip chip-warning plain">Change pending</span>;
  if (e.invoice && e.invoice.status !== "void") {
    const label = e.invoice.status === "draft" ? "On draft" : `On ${e.invoice.number}`;
    return isAdmin ? (
      <Link href={`/invoices/${e.invoice.id}`} className="chip chip-neutral plain gap-1">
        {e.invoice.status === "issued" && <Lock size={10} />} {label}
      </Link>
    ) : (
      <span className="chip chip-neutral plain">{label}</span>
    );
  }
  if (e.offInvoice === "billed_elsewhere") return <span className="chip chip-neutral plain">Billed elsewhere{e.offInvoiceRef ? ` · ${e.offInvoiceRef}` : ""}</span>;
  if (e.offInvoice === "written_off") return <span className="chip chip-neutral plain">Written off</span>;
  if (e.task?.billingMode === "fixed") return <span className="chip chip-neutral plain">Fixed fee</span>;
  if (e.task?.billingMode === "non_billable" || !e.billable) return <span className="chip chip-neutral plain">Non-billable</span>;
  return null;
}
