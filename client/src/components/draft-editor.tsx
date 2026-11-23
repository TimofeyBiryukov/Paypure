"use client";

import {
  addDays,
  type EditableLine,
  formatMoney,
  formatPercentBp,
  minorToDecimalString,
  parseMoney,
  parsePercentBp,
  type SheetData,
  sheetFromLines,
} from "@paypure/domain";
import { Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { saveDraft } from "@/app/actions/invoices";
import { InvoiceSheet } from "./sheet";

export interface OpenVersion {
  id: string;
  rev: number;
  isCorrection: boolean;
  issueDate: string | null;
  dueDate: string | null;
  dueDateManual: boolean;
  termsDays: number;
  summary: string;
  notes: string;
  paymentAccountMode: "default" | "account" | "none";
  paymentAccountId: string | null;
  lines: (EditableLine & { id: string; entryCount: number; outdated: boolean })[];
  taxes: { id: string; name: string; rateBp: number }[];
  sheet: SheetData;
}

type Line = EditableLine & { key: string; entryCount?: number; outdated?: boolean };
type Tax = { id: string; name: string; rateBp: number };

let seq = 0;
const tmp = (p: string) => `${p}-${Date.now()}-${seq++}`;

/**
 * Draft and correction editor (S11). Drafts have no external effect, so they autosave: the
 * editor is one real <form> submitted with requestSubmit() after a short debounce (Guide §7.1).
 */
export function DraftEditor({
  invoiceId,
  currency,
  open,
  accounts,
  today,
  current,
  netPaidMinor,
  onTotal,
}: {
  invoiceId: string;
  currency: string;
  open: OpenVersion;
  accounts: { id: string; label: string; bankName: string; last4: string; isDefault: boolean }[];
  today: string;
  current: SheetData | null;
  netPaidMinor: number;
  onTotal?: (n: number) => void;
}) {
  const [lines, setLines] = useState<Line[]>(() => open.lines.map((l) => ({ ...l, key: l.id })));
  const [taxes, setTaxes] = useState<Tax[]>(open.taxes);
  const [summary, setSummary] = useState(open.summary);
  const [notes, setNotes] = useState(open.notes);
  const [termsDays, setTermsDays] = useState(open.termsDays);
  const [dueDate, setDueDate] = useState(open.dueDateManual ? (open.dueDate ?? "") : "");
  const [issueDate, setIssueDate] = useState(open.issueDate ?? "");
  const [accMode, setAccMode] = useState(
    open.paymentAccountMode === "account" && open.paymentAccountId
      ? open.paymentAccountId
      : open.paymentAccountMode,
  );
  const [newTax, setNewTax] = useState({ name: "", rate: "" });
  const [state, formAction, pending] = useActionState(saveDraft, null);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = useRef(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const sheetLines = lines.map((l) => ({ ...l }));
  const computed = useMemo(
    () => sheetFromLines(sheetLines, taxes),
    [JSON.stringify(sheetLines), JSON.stringify(taxes)],
  );
  useEffect(() => onTotal?.(computed.totalMinor), [computed.totalMinor, onTotal]);

  const payload = {
    summary,
    notes,
    termsDays,
    dueDate: dueDate || null,
    ...(open.isCorrection ? {} : { issueDate: issueDate || null }),
    paymentAccountMode: accMode === "default" || accMode === "none" ? accMode : "account",
    paymentAccountId: accMode === "default" || accMode === "none" ? null : accMode,
    taxes,
    lines: lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      title: l.title,
      detail: l.detail,
      qtyHundredths: l.qtyHundredths,
      unit: l.unit,
      rateMinor: l.rateMinor,
      discountRateBp: l.discountRateBp ?? null,
      taxIds: l.taxIds,
    })),
  };
  const payloadJson = JSON.stringify(payload);

  // Debounced autosave through the form's own submit path.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    dirty.current = true;
    const t = setTimeout(() => formRef.current?.requestSubmit(), 700);
    return () => clearTimeout(t);
  }, [payloadJson]);

  // Adopt server ids for new lines and taxes after a save.
  useEffect(() => {
    if (!state?.ok || !state.data) return;
    const d = state.data as {
      savedAt: string;
      taxIdMap: Record<string, string>;
      lineIds: string[];
    };
    setSavedAt(d.savedAt);
    dirty.current = false;
    const map = d.taxIdMap ?? {};
    setTaxes((ts) => ts.map((t) => ({ ...t, id: map[t.id] ?? t.id })));
    setLines((ls) =>
      ls.map((l, i) => ({
        ...l,
        id: l.id ?? d.lineIds?.[i],
        taxIds: l.taxIds.map((x) => map[x] ?? x),
      })),
    );
  }, [state]);

  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = (kind: "manual" | "discount") =>
    setLines((ls) => {
      const nl: Line = {
        key: tmp("line"),
        kind,
        title: kind === "discount" ? "Discount" : "",
        detail: "",
        qtyHundredths: 100,
        unit: "",
        rateMinor: 0,
        discountRateBp: kind === "discount" ? 1000 : null,
        taxIds: taxes.map((t) => t.id),
      };
      const nonDiscount = ls.filter((l) => l.kind !== "discount");
      const disc = ls.filter((l) => l.kind === "discount");
      return kind === "discount" ? [...nonDiscount, nl] : [...nonDiscount, nl, ...disc];
    });
  const hasDiscount = lines.some((l) => l.kind === "discount");
  const outdated = lines.filter((l) => l.outdated).length;
  const due = dueDate || addDays(issueDate || today, termsDays);
  const overpay = open.isCorrection && netPaidMinor > computed.totalMinor;

  return (
    <div className="space-y-6">
      <form
        ref={formRef}
        action={formAction}
        className="grid xl:grid-cols-[1fr_300px] gap-6 items-start"
      >
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="payload" value={payloadJson} />
        <div className="card p-5 space-y-4 min-w-0">
          {outdated > 0 && <p className="sr-only">{outdated} lines out of date</p>}
          <div>
            <label className="label" htmlFor="summary">
              Summary (optional, one line)
            </label>
            <input
              id="summary"
              className="input"
              value={summary}
              maxLength={500}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Website and app development, November"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="t-caption text-left">
                  <th className="py-2 font-medium">Description</th>
                  <th className="py-2 font-medium w-24 text-right">Qty</th>
                  <th className="py-2 font-medium w-20 pl-2">Unit</th>
                  <th className="py-2 font-medium w-28 text-right">Rate</th>
                  <th className="py-2 font-medium w-28 text-right">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const i = computed.lines.findIndex(
                    (_, idx) =>
                      lines
                        .filter((x) => x.kind !== "discount")
                        .concat(lines.filter((x) => x.kind === "discount"))[idx]?.key === l.key,
                  );
                  const amount = computed.lines[i]?.amountMinor ?? 0;
                  return (
                    <tr key={l.key} className="border-t border-line align-top">
                      <td className="py-2 pr-2">
                        {l.kind === "discount" ? (
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Discount</span>
                            <select
                              className="select w-auto h-8 py-0"
                              value={l.discountRateBp != null ? "pct" : "amt"}
                              onChange={(e) =>
                                update(
                                  l.key,
                                  e.target.value === "pct"
                                    ? { discountRateBp: 1000 }
                                    : { discountRateBp: null, rateMinor: -Math.abs(amount) },
                                )
                              }
                              aria-label="Discount type"
                            >
                              <option value="pct">Percent</option>
                              <option value="amt">Amount</option>
                            </select>
                            {l.discountRateBp != null ? (
                              <PercentInput
                                bp={l.discountRateBp}
                                onChange={(bp) => update(l.key, { discountRateBp: bp })}
                              />
                            ) : (
                              <MoneyInput
                                minor={Math.abs(l.rateMinor)}
                                currency={currency}
                                onChange={(m) => update(l.key, { rateMinor: -m })}
                                label="Discount amount"
                              />
                            )}
                          </div>
                        ) : (
                          <>
                            <textarea
                              className="textarea min-h-[36px] font-medium"
                              rows={1}
                              value={l.title}
                              aria-label="Line title"
                              placeholder="Description"
                              onChange={(e) => update(l.key, { title: e.target.value })}
                            />
                            <textarea
                              className="textarea min-h-[32px] mt-1 text-muted text-[13px]"
                              rows={1}
                              value={l.detail}
                              aria-label="Line detail"
                              placeholder="Detail (optional)"
                              onChange={(e) => update(l.key, { detail: e.target.value })}
                            />
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {l.kind === "time" && (
                                <span className="t-caption">
                                  {l.entryCount} {l.entryCount === 1 ? "entry" : "entries"}
                                </span>
                              )}
                              {l.kind === "fixed" && <span className="t-caption">Fixed fee</span>}
                              {l.outdated && (
                                <span className="chip chip-warning plain">Out of date</span>
                              )}
                              {taxes.map((t) => {
                                const on = l.taxIds.includes(t.id);
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    className={`chip plain ${on ? "chip-info" : "chip-void"}`}
                                    aria-pressed={on}
                                    onClick={() =>
                                      update(l.key, {
                                        taxIds: on
                                          ? l.taxIds.filter((x) => x !== t.id)
                                          : [...l.taxIds, t.id],
                                      })
                                    }
                                  >
                                    {t.name}
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {l.kind !== "discount" && (
                          <input
                            className="input text-right h-8"
                            aria-label="Quantity"
                            defaultValue={(l.qtyHundredths / 100).toFixed(2).replace(/\.00$/, "")}
                            inputMode="decimal"
                            onBlur={(e) => {
                              const n = Number(e.target.value.replace(",", "."));
                              if (Number.isFinite(n) && n >= 0)
                                update(l.key, { qtyHundredths: Math.round(n * 100) });
                            }}
                          />
                        )}
                      </td>
                      <td className="py-2 pl-2">
                        {l.kind === "manual" && (
                          <input
                            className="input h-8"
                            aria-label="Unit"
                            value={l.unit}
                            onChange={(e) => update(l.key, { unit: e.target.value })}
                            placeholder="h"
                          />
                        )}
                        {l.kind === "time" && <span className="text-muted">h</span>}
                      </td>
                      <td className="py-2 text-right">
                        {l.kind !== "discount" && (
                          <MoneyInput
                            minor={l.rateMinor}
                            currency={currency}
                            onChange={(m) => update(l.key, { rateMinor: m })}
                            label="Rate"
                          />
                        )}
                      </td>
                      <td className="py-2 text-right tnum font-medium whitespace-nowrap">
                        {formatMoney({ minor: amount, currency })}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          aria-label="Remove line"
                          title={
                            l.kind === "time"
                              ? "Removes the line; its time goes back to unbilled"
                              : "Remove line"
                          }
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => addLine("manual")}
            >
              <Plus size={14} /> Manual line
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={hasDiscount}
              title={hasDiscount ? "One discount per invoice" : undefined}
              onClick={() => addLine("discount")}
            >
              <Plus size={14} /> Discount
            </button>
          </div>
          <dl className="ml-auto w-full sm:w-72 text-sm">
            <div className="flex justify-between py-1">
              <dt className="text-muted">Subtotal</dt>
              <dd className="tnum">{formatMoney({ minor: computed.subtotalMinor, currency })}</dd>
            </div>
            {computed.taxes.map((t) => (
              <div key={t.name + t.rateBp} className="flex justify-between py-1">
                <dt className="text-muted">
                  {t.name} {formatPercentBp(t.rateBp)}
                </dt>
                <dd className="tnum">{formatMoney({ minor: t.amountMinor, currency })}</dd>
              </div>
            ))}
            <div className="flex justify-between py-2 border-t border-line font-semibold">
              <dt>Total</dt>
              <dd className="tnum">
                {formatMoney({ minor: computed.totalMinor, currency }, { withCode: true })}
              </dd>
            </div>
          </dl>
          {computed.errors.length > 0 && (
            <p className="banner banner-danger text-sm">{computed.errors[0]}</p>
          )}
          {overpay && (
            <p className="banner banner-warning text-sm">
              Paid {formatMoney({ minor: netPaidMinor, currency })} is more than the new total{" "}
              {formatMoney({ minor: computed.totalMinor, currency })}. It will be overpaid by{" "}
              {formatMoney({ minor: netPaidMinor - computed.totalMinor, currency })}.
            </p>
          )}
          <div>
            <label className="label" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              className="textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <aside className="card p-5 space-y-4 text-sm">
          {!open.isCorrection && (
            <div>
              <label className="label" htmlFor="issueDate">
                Issue date
              </label>
              <input
                id="issueDate"
                type="date"
                className="input"
                value={issueDate}
                max={today}
                onChange={(e) => setIssueDate(e.target.value)}
              />
              <p className="hint">
                {issueDate ? "Can't be before the last issued invoice." : "Set when you send."}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="terms">
                Terms (days)
              </label>
              <input
                id="terms"
                type="number"
                min={0}
                max={365}
                className="input"
                value={termsDays}
                onChange={(e) => setTermsDays(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="label" htmlFor="due">
                Due
              </label>
              <input
                id="due"
                type="date"
                className="input"
                value={dueDate || due}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <span className="label">Currency</span>
            <span>{currency} (locked)</span>
          </div>
          <fieldset>
            <legend className="label">Taxes</legend>
            <ul className="space-y-1 mb-2">
              {taxes.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="flex-1">
                    {t.name} {formatPercentBp(t.rateBp)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={`Remove ${t.name}`}
                    onClick={() => {
                      setTaxes((ts) => ts.filter((x) => x.id !== t.id));
                      setLines((ls) =>
                        ls.map((l) => ({ ...l, taxIds: l.taxIds.filter((x) => x !== t.id) })),
                      );
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-1">
              <input
                className="input h-8"
                placeholder="VAT"
                aria-label="Tax name"
                value={newTax.name}
                onChange={(e) => setNewTax((x) => ({ ...x, name: e.target.value }))}
              />
              <input
                className="input h-8 w-20"
                placeholder="10%"
                aria-label="Tax rate"
                value={newTax.rate}
                onChange={(e) => setNewTax((x) => ({ ...x, rate: e.target.value }))}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const bp = parsePercentBp(newTax.rate);
                  if (!newTax.name.trim() || bp == null) return;
                  const id = tmp("tax");
                  setTaxes((ts) => [...ts, { id, name: newTax.name.trim(), rateBp: bp }]);
                  // A new tax applies to every line by default (07 §7.1)
                  setLines((ls) => ls.map((l) => ({ ...l, taxIds: [...l.taxIds, id] })));
                  setNewTax({ name: "", rate: "" });
                }}
              >
                Add
              </button>
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor="account">
              Pay to
            </label>
            <select
              id="account"
              className="select"
              value={accMode}
              onChange={(e) => setAccMode(e.target.value)}
            >
              <option value="default">Default for {currency}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.bankName} ··{a.last4}
                  {a.isDefault ? " (Default)" : ""}
                </option>
              ))}
              <option value="none">None</option>
            </select>
            {accounts.length === 0 && (
              <p className="hint text-warning">
                No payment account for {currency} · add one in Settings → Business
              </p>
            )}
          </div>
          <p className="t-caption" aria-live="polite">
            {pending ? (
              "Saving…"
            ) : state && !state.ok ? (
              <span className="text-danger">{state.error}</span>
            ) : savedAt ? (
              `Saved · ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            ) : (
              "All changes save automatically"
            )}
          </p>
          <button type="submit" className="btn btn-secondary btn-sm">
            Save now
          </button>
        </aside>
      </form>

      {open.isCorrection && current && (
        <ChangesPanel before={current} after={computed} currency={currency} />
      )}

      <section>
        <h2 className="t-title-3 mb-2">Preview</h2>
        <div className="overflow-x-auto">
          <InvoiceSheet
            s={{
              ...open.sheet,
              summary,
              notes,
              issueDate: open.isCorrection ? open.sheet.issueDate : issueDate || null,
              dueDate: issueDate || open.isCorrection ? due : null,
              lines: computed.lines,
              taxes: computed.taxes,
              subtotalMinor: computed.subtotalMinor,
              totalMinor: computed.totalMinor,
              paymentAccount: accMode === "none" ? null : open.sheet.paymentAccount,
            }}
          />
        </div>
      </section>
    </div>
  );
}

/** Changed / added / removed lines and totals before → after (08 §4.2). */
function ChangesPanel({
  before,
  after,
  currency,
}: {
  before: SheetData;
  after: { lines: SheetData["lines"]; totalMinor: number };
  currency: string;
}) {
  const m = (n: number) => formatMoney({ minor: n, currency });
  const key = (l: SheetData["lines"][number]) => l.title;
  const changes: string[] = [];
  for (const l of after.lines) {
    const b = before.lines.find((x) => key(x) === key(l));
    if (!b) changes.push(`Added "${l.title}" (${m(l.amountMinor)})`);
    else if (
      b.qtyHundredths !== l.qtyHundredths ||
      b.rateMinor !== l.rateMinor ||
      b.detail !== l.detail
    )
      changes.push(
        `"${l.title}": ${(b.qtyHundredths / 100).toFixed(2)} × ${m(b.rateMinor)} → ${(l.qtyHundredths / 100).toFixed(2)} × ${m(l.rateMinor)}${b.detail !== l.detail ? " (detail edited)" : ""}`,
      );
  }
  for (const b of before.lines)
    if (!after.lines.find((l) => key(l) === key(b)))
      changes.push(`Removed "${b.title}" (${m(b.amountMinor)})`);
  return (
    <section className="card p-5">
      <h2 className="t-title-3 mb-2">Changes</h2>
      {changes.length === 0 ? (
        <p className="text-muted">No line changes yet.</p>
      ) : (
        <ul className="list-disc pl-5 space-y-1">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 tnum">
        Total {m(before.totalMinor)} → <b>{m(after.totalMinor)}</b>
      </p>
    </section>
  );
}

export function correctionSummary(before: SheetData, afterTotal: number, currency: string) {
  const m = (n: number) => formatMoney({ minor: n, currency });
  return before.totalMinor === afterTotal
    ? "Details updated"
    : `Total ${m(before.totalMinor)} → ${m(afterTotal)}`;
}

function MoneyInput({
  minor,
  currency,
  onChange,
  label,
}: {
  minor: number;
  currency: string;
  onChange: (m: number) => void;
  label: string;
}) {
  const [v, setV] = useState(minorToDecimalString(minor, currency));
  useEffect(() => setV(minorToDecimalString(minor, currency)), [minor, currency]);
  return (
    <input
      className="input text-right h-8"
      aria-label={label}
      value={v}
      inputMode="decimal"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const p = parseMoney(v, currency);
        if (p != null && p >= 0) onChange(p);
        else setV(minorToDecimalString(minor, currency));
      }}
    />
  );
}

function PercentInput({ bp, onChange }: { bp: number; onChange: (bp: number) => void }) {
  const [v, setV] = useState(String(bp / 100));
  return (
    <input
      className="input text-right h-8 w-20"
      aria-label="Discount percent"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const p = parsePercentBp(v);
        if (p != null && p <= 10000) onChange(p);
      }}
    />
  );
}
