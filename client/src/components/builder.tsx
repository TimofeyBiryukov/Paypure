"use client";

import {
  buildFixedLine,
  buildTimeLines,
  type EditableLine,
  formatDateShort,
  formatHoursMinutes,
  formatMoney,
  type LineLayout,
  lineAmount,
  minorToDecimalString,
  parseMoney,
  type SheetData,
  secondsToHundredths,
  sheetFromLines,
} from "@paypure/domain";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { createDraft } from "@/app/actions/invoices";
import { InvoiceSheet } from "./sheet";
import { Submit } from "./submit";
import { ActionForm, FieldError } from "./toaster";

export interface BuilderEntry {
  id: string;
  date: string;
  seconds: number;
  note: string;
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  rateMinor: number | null;
  rateSource: string | null;
  member: string;
  onDraft: { id: string; label: string } | null;
}

export interface BuilderData {
  client: { id: string; name: string; colour: number; currency: string; termsDays: number; lineLayout: LineLayout };
  entries: BuilderEntry[];
  fixed: { taskId: string; taskName: string; projectName: string; feeMinor: number; remainingMinor: number; trackedSeconds: number }[];
  liveTimers: { member: string; startedAt: string | null }[];
  taxes: { id: string; name: string; rateBp: number }[];
  from: SheetData["from"];
  to: SheetData["to"];
  paymentAccount: { label: string } | null;
}

type Period = "all" | "today" | "upto" | "range";

/**
 * Invoice builder (S9): pick individual entries, see the invoice update instantly. The preview
 * uses the same @paypure/domain code the API uses to create the draft (T7), so they agree.
 */
export function Builder({ data, today }: { data: BuilderData; today: string }) {
  const cur = data.client.currency;
  const available = data.entries.filter((e) => !e.onDraft);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(available.map((e) => e.id)));
  const [layout, setLayout] = useState<LineLayout>(data.client.lineLayout);
  const [period, setPeriod] = useState<Period>("all");
  const [upto, setUpto] = useState(today);
  const [rangeFrom, setRangeFrom] = useState(available[0]?.date ?? today);
  const [fixedOn, setFixedOn] = useState<Record<string, boolean>>({});
  const [fixedAmt, setFixedAmt] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.fixed.map((f) => [f.taskId, minorToDecimalString(f.remainingMinor, cur)])),
  );
  const [open, setOpen] = useState<Set<string>>(new Set());

  const inPeriod = (d: string) =>
    period === "all" ? true : period === "today" ? d <= today : period === "upto" ? d <= upto : d >= rangeFrom && d <= upto;
  const visible = available.filter((e) => inPeriod(e.date));
  const chosen = visible.filter((e) => selected.has(e.id));

  const tree = useMemo(() => {
    const projects = new Map<string, { name: string; tasks: Map<string, { name: string; entries: BuilderEntry[] }> }>();
    for (const e of data.entries.filter((x) => inPeriod(x.date))) {
      const p = projects.get(e.projectId) ?? { name: e.projectName, tasks: new Map() };
      const t = p.tasks.get(e.taskId) ?? { name: e.taskName, entries: [] };
      t.entries.push(e);
      p.tasks.set(e.taskId, t);
      projects.set(e.projectId, p);
    }
    return projects;
    // biome-ignore lint/correctness/useExhaustiveDependencies: inPeriod derives from these
  }, [data.entries, period, upto, rangeFrom]);

  const fixedChosen = data.fixed
    .filter((f) => fixedOn[f.taskId])
    .map((f) => ({ f, amount: parseMoney(fixedAmt[f.taskId] ?? "", cur) }));
  const fixedInvalid = fixedChosen.some(({ f, amount }) => !amount || amount <= 0 || amount > f.remainingMinor);

  const preview = useMemo(() => {
    const timeLines = buildTimeLines(
      chosen.map((e) => ({ id: e.id, date: e.date, seconds: e.seconds, note: e.note, taskId: e.taskId, projectName: e.projectName, taskName: e.taskName, rateMinor: e.rateMinor })),
      layout,
    );
    const fixedLines = fixedChosen
      .filter(({ amount }) => amount && amount > 0)
      .map(({ f, amount }) =>
        buildFixedLine({ taskId: f.taskId, projectName: f.projectName, taskName: f.taskName, currency: cur, feeMinor: f.feeMinor, remainingMinor: f.remainingMinor, amountMinor: Math.min(amount as number, f.remainingMinor) }),
      );
    const taxIds = data.taxes.map((t) => t.id);
    const lines: EditableLine[] = [...timeLines, ...fixedLines].map((l) => ({ kind: l.kind, title: l.title, detail: l.detail, qtyHundredths: l.qtyHundredths, unit: l.unit, rateMinor: l.rateMinor, taxIds }));
    const s = sheetFromLines(lines, data.taxes);
    const sheet: SheetData = {
      number: null,
      rev: 1,
      revisedOn: null,
      issueDate: null,
      dueDate: null,
      currency: cur,
      summary: "",
      notes: "",
      from: data.from,
      to: data.to,
      paymentAccount: null,
      ...s,
    };
    return { sheet, lineCount: lines.length };
    // biome-ignore lint/correctness/useExhaustiveDependencies: derived from selection state
  }, [chosen.length, selected, layout, fixedOn, fixedAmt, period, upto, rangeFrom]);

  const noRate = chosen.filter((e) => e.rateMinor == null);
  const secs = chosen.reduce((s, e) => s + e.seconds, 0);
  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of ids) on ? n.add(id) : n.delete(id);
      return n;
    });
  const state = (ids: string[]) => {
    const k = ids.filter((id) => selected.has(id)).length;
    return k === 0 ? "none" : k === ids.length ? "all" : "some";
  };

  if (data.entries.length === 0 && data.fixed.length === 0) {
    return (
      <div className="well">
        <p className="mb-3">{data.client.name} has no unbilled time.</p>
        <Link href={`/clients/${data.client.id}`} className="btn btn-secondary">
          Back to {data.client.name}
        </Link>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[480px_1fr] gap-6 items-start">
      <ActionForm action={createDraft} className="card p-5 space-y-5 lg:sticky lg:top-20">
        <input type="hidden" name="clientId" value={data.client.id} />
        <input type="hidden" name="currency" value={cur} />

        {data.liveTimers.length > 0 && (
          <div className="banner banner-warning text-sm">
            {data.liveTimers.length === 1 ? "A timer is" : `${data.liveTimers.length} timers are`} running on {data.client.name} (
            {[...new Set(data.liveTimers.map((t) => t.member))].join(", ")}). Stop {data.liveTimers.length === 1 ? "it" : "them"} to include that time.
          </div>
        )}

        <fieldset>
          <legend className="label">Period</legend>
          <div className="flex flex-wrap gap-2 items-center">
            <select className="select w-auto" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
              <option value="all">All unbilled</option>
              <option value="today">Up to today</option>
              <option value="upto">Up to…</option>
              <option value="range">Range…</option>
            </select>
            {period === "range" && <input type="date" className="input w-auto" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} aria-label="From" />}
            {(period === "upto" || period === "range") && <input type="date" className="input w-auto" value={upto} onChange={(e) => setUpto(e.target.value)} aria-label="Up to" />}
          </div>
        </fieldset>

        <div className="max-h-[46vh] overflow-auto -mx-2 px-2">
          {[...tree.entries()].map(([pid, p]) => {
            const pIds = [...p.tasks.values()].flatMap((t) => t.entries.filter((e) => !e.onDraft).map((e) => e.id));
            const pSecs = [...p.tasks.values()].flatMap((t) => t.entries).filter((e) => selected.has(e.id) && !e.onDraft).reduce((s, e) => s + e.seconds, 0);
            const ps = state(pIds);
            return (
              <div key={pid} className="mb-3">
                <label className="flex items-center gap-2 font-semibold py-1">
                  <input type="checkbox" checked={ps === "all"} ref={(el) => { if (el) el.indeterminate = ps === "some"; }} onChange={(e) => toggle(pIds, e.target.checked)} />
                  <span className="flex-1">{p.name}</span>
                  <span className="tnum text-muted font-normal">{formatHoursMinutes(pSecs)}</span>
                </label>
                {[...p.tasks.entries()].map(([tid, t]) => {
                  const tIds = t.entries.filter((e) => !e.onDraft).map((e) => e.id);
                  const ts = state(tIds);
                  const tChosen = t.entries.filter((e) => selected.has(e.id) && !e.onDraft);
                  const tSecs = tChosen.reduce((s, e) => s + e.seconds, 0);
                  const rate = t.entries[0]?.rateMinor;
                  const expanded = open.has(tid);
                  return (
                    <div key={tid} className="ml-5">
                      <div className="flex items-center gap-2 py-1">
                        <input type="checkbox" aria-label={`Select ${t.name}`} checked={ts === "all"} ref={(el) => { if (el) el.indeterminate = ts === "some"; }} onChange={(e) => toggle(tIds, e.target.checked)} disabled={tIds.length === 0} />
                        <span className="flex-1 truncate">{t.name}</span>
                        <span className="tnum text-muted">{formatHoursMinutes(tSecs)}</span>
                        <span className="tnum w-20 text-right">
                          {rate == null ? <span className="text-warning">No rate</span> : formatMoney({ minor: lineAmount(secondsToHundredths(tSecs), rate), currency: cur })}
                        </span>
                        <button type="button" className="btn btn-ghost btn-sm px-1" aria-expanded={expanded} aria-label={`Show ${t.entries.length} entries`} onClick={() => setOpen((o) => { const n = new Set(o); expanded ? n.delete(tid) : n.add(tid); return n; })}>
                          <ChevronRight size={14} className={expanded ? "rotate-90" : ""} /> {t.entries.length}
                        </button>
                      </div>
                      {/* Each entry is a real checkbox in the form (named entryIds), even when collapsed */}
                      <ul className={expanded ? "ml-6 mb-2" : "hidden"}>
                        {t.entries.map((e) => (
                          <li key={e.id} className="flex items-start gap-2 py-0.5 text-[13px]">
                            <input type="checkbox" name="entryIds" value={e.id} checked={!e.onDraft && selected.has(e.id)} disabled={!!e.onDraft} onChange={(ev) => toggle([e.id], ev.target.checked)} aria-label={`${formatDateShort(e.date)} ${e.note}`} className="mt-1" />
                            <span className="w-24 shrink-0 text-muted">{formatDateShort(e.date)}</span>
                            <span className="flex-1 truncate">{e.onDraft ? <span className="text-muted">{e.onDraft.label}</span> : e.note.split("\n")[0] || <span className="text-faint">No note</span>}</span>
                            <span className="tnum">{formatHoursMinutes(e.seconds)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {data.fixed.map((f) => (
            <div key={f.taskId} className="py-2 border-t border-line">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="fixedTaskIds" value={f.taskId} checked={!!fixedOn[f.taskId]} onChange={(e) => setFixedOn((o) => ({ ...o, [f.taskId]: e.target.checked }))} />
                <span className="flex-1">
                  {f.projectName} · {f.taskName} <span className="t-caption">(fixed fee)</span>
                </span>
              </label>
              <div className="ml-6 flex items-center gap-2 mt-1 text-sm">
                <label htmlFor={`fixed_${f.taskId}`}>Bill</label>
                <input id={`fixed_${f.taskId}`} name={`fixed_${f.taskId}`} className="input w-28" value={fixedAmt[f.taskId]} onChange={(e) => setFixedAmt((a) => ({ ...a, [f.taskId]: e.target.value }))} inputMode="decimal" disabled={!fixedOn[f.taskId]} />
                <span className="text-muted">of {formatMoney({ minor: f.remainingMinor, currency: cur })} remaining</span>
              </div>
              <p className="ml-6 t-caption">{formatHoursMinutes(f.trackedSeconds)} tracked · covered by the fee</p>
              <FieldError name={`fixed_${f.taskId}`} />
            </div>
          ))}
        </div>

        <fieldset>
          <legend className="label">Lines</legend>
          <div className="flex flex-col gap-1">
            {(
              [
                ["per_task", "One per task"],
                ["per_task_week", "One per task per week"],
                ["per_entry", "One per entry"],
              ] as const
            ).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="mode" value={v} checked={layout.mode === v} onChange={() => setLayout((x) => ({ ...x, mode: v }))} />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex gap-4">
          <legend className="label">Show on lines</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="showDates" checked={layout.showDates} onChange={(e) => setLayout((x) => ({ ...x, showDates: e.target.checked }))} /> dates
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="showNotes" checked={layout.showNotes} onChange={(e) => setLayout((x) => ({ ...x, showNotes: e.target.checked }))} /> entry notes
          </label>
        </fieldset>

        <div className="border-t border-line pt-4 space-y-3">
          <p className="tnum">
            {chosen.length} {chosen.length === 1 ? "entry" : "entries"} · {formatHoursMinutes(secs)} · <b>{formatMoney({ minor: preview.sheet.subtotalMinor, currency: cur })}</b>
            {data.taxes.length > 0 && <span className="text-muted"> + {data.taxes.map((t) => t.name).join(", ")}</span>}
          </p>
          {noRate.length > 0 && (
            <p className="banner banner-warning text-sm">
              Set a rate for {data.client.name} to bill {formatHoursMinutes(noRate.reduce((s, e) => s + e.seconds, 0))}.{" "}
              <Link href={`/clients/${data.client.id}?tab=details`} className="underline">
                Set a rate
              </Link>
            </p>
          )}
          <Submit
            pendingText="Creating draft…"
            className="btn btn-primary w-full btn-lg"
            disabled={noRate.length > 0 || fixedInvalid || preview.lineCount === 0}
            title={noRate.length > 0 ? "Some selected time has no rate" : preview.lineCount === 0 ? "Select some work to bill" : undefined}
          >
            Create draft
          </Submit>
          <p className="t-caption">The entries are reserved for this invoice as soon as the draft exists, so they can't be invoiced twice.</p>
        </div>
      </ActionForm>

      <div className="overflow-x-auto">
        <div className="t-caption mb-2">Preview · {preview.lineCount} lines</div>
        <InvoiceSheet s={preview.sheet} />
      </div>
    </div>
  );
}
