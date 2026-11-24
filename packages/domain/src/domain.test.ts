import { describe, expect, it } from "vitest";
import {
  buildFixedLine,
  buildTimeLines,
  computeInvoice,
  coveredSeconds,
  displayStatus,
  formatInvoiceNumber,
  formatMoney,
  fromWallTime,
  lineAmount,
  parseDuration,
  parseMoney,
  parseTimeOfDay,
  percentOf,
  resolveRate,
  secondsToHundredths,
  toLocalDate,
  unbilledFixed,
  validateNumberFormat,
} from "./index";

// 07 §9 worked examples
describe("07 §9 worked examples", () => {
  it("1: seconds → hundredths", () => {
    expect([3600, 17, 18, 3617, 3618].map(secondsToHundredths)).toEqual([100, 0, 1, 100, 101]);
  });
  it("2: Paydirt half cent", () => expect(lineAmount(587, 3250)).toBe(19078));
  it("3: Paydirt sample", () => expect(lineAmount(102, 6000)).toBe(6120));
  it("4: grouping vs per entry", () => {
    const entries = [1, 2, 3].map((i) => ({
      id: `e${i}`,
      date: `2026-11-0${i}`,
      seconds: 627,
      note: "",
      taskId: "t",
      projectName: "P",
      taskName: "T",
      rateMinor: 9000,
    }));
    const perEntry = buildTimeLines(entries, { mode: "per_entry", showDates: true, showNotes: true });
    const perEntryTotal = computeInvoice(
      perEntry.map((l) => ({ ...l, taxIds: [] })),
      [],
    ).totalMinor;
    expect(perEntry.map((l) => l.qtyHundredths)).toEqual([17, 17, 17]);
    expect(perEntryTotal).toBe(4590);
    const grouped = buildTimeLines(entries, { mode: "per_task", showDates: true, showNotes: false });
    expect(grouped).toHaveLength(1);
    expect(grouped[0].qtyHundredths).toBe(52);
    expect(computeInvoice(grouped.map((l) => ({ ...l, taxIds: [] })), []).totalMinor).toBe(4680);
  });
  it("5: invoice with VAT", () => {
    const r = computeInvoice(
      [112500, 279000, 4000].map((rate) => ({ kind: "manual" as const, qtyHundredths: 100, rateMinor: rate, taxIds: ["vat"] })),
      [{ id: "vat", name: "VAT", rateBp: 1000 }],
    );
    expect(r.subtotalMinor).toBe(395500);
    expect(r.taxTotalMinor).toBe(39550);
    expect(r.totalMinor).toBe(435050);
  });
  it("6: tax half", () => expect(percentOf(12345, 1000)).toBe(1235));
  it("7: tax only on some lines", () => {
    const r = computeInvoice(
      [
        { kind: "manual", qtyHundredths: 100, rateMinor: 100000, taxIds: ["t"] },
        { kind: "manual", qtyHundredths: 100, rateMinor: 4000, taxIds: [] },
      ],
      [{ id: "t", name: "VAT", rateBp: 2000 }],
    );
    expect(r.taxTotalMinor).toBe(20000);
    expect(r.totalMinor).toBe(124000);
  });
  it("8: discount before tax", () => {
    const r = computeInvoice(
      [
        { kind: "manual", qtyHundredths: 100, rateMinor: 100000, taxIds: ["v"] },
        { kind: "discount", qtyHundredths: 100, rateMinor: 0, discountRateBp: 1000, taxIds: ["v"] },
      ],
      [{ id: "v", name: "VAT", rateBp: 2000 }],
    );
    expect(r.discountMinor).toBe(-10000);
    expect(r.taxTotalMinor).toBe(18000);
    expect(r.totalMinor).toBe(108000);
  });
  it("9: negative half", () => {
    const r = computeInvoice(
      [
        { kind: "manual", qtyHundredths: 100, rateMinor: 12345, taxIds: [] },
        { kind: "discount", qtyHundredths: 100, rateMinor: 0, discountRateBp: 1000, taxIds: [] },
      ],
      [],
    );
    expect(r.lines[1].amountMinor).toBe(-1235);
  });
  it("10/11: fixed fee remaining", () => {
    expect(unbilledFixed(120000, 60000 + 30000)).toBe(30000);
    expect(unbilledFixed(120000, 30000)).toBe(90000);
    expect(unbilledFixed(120000, 0)).toBe(120000);
    expect(unbilledFixed(60000, 80000)).toBe(0);
  });
  it("12: currency mismatch", () => {
    expect(
      resolveRate({
        taskRateMinor: null,
        projectRateMinor: null,
        clientRateMinor: null,
        clientCurrency: "USD",
        workspaceRateMinor: 9000,
        workspaceCurrency: "EUR",
      }),
    ).toBeNull();
  });
  it("13: JPY", () => {
    expect(lineAmount(150, 8000)).toBe(12000);
    expect(formatMoney({ minor: 12000, currency: "JPY" })).toBe("¥12,000");
  });
  it("14: overpaid", () => {
    const s = displayStatus({ status: "issued", totalMinor: 435050, netPaidMinor: 440000, dueDate: "2026-12-01", today: "2026-12-10" });
    expect(s.key).toBe("paid");
    expect(s.balanceMinor).toBe(-4950);
    expect(s.overpaidMinor).toBe(4950);
  });
});

describe("rates", () => {
  const base = { taskRateMinor: null, projectRateMinor: null, clientRateMinor: null, clientCurrency: "EUR", workspaceRateMinor: null, workspaceCurrency: "EUR" };
  it("resolves in order and a 0 rate is real", () => {
    expect(resolveRate({ ...base, clientRateMinor: 9000, projectRateMinor: 0 })).toEqual({ rateMinor: 0, source: "project" });
    expect(resolveRate({ ...base, workspaceRateMinor: 5000 })).toEqual({ rateMinor: 5000, source: "workspace" });
  });
});

describe("status", () => {
  const s = (o: Partial<Parameters<typeof displayStatus>[0]>) =>
    displayStatus({ status: "issued", totalMinor: 1000, netPaidMinor: 0, dueDate: "2026-12-15", today: "2026-12-01", ...o }).label;
  it("orders checks", () => {
    expect(s({ status: "void" })).toBe("Void");
    expect(s({ status: "draft" })).toBe("Draft");
    expect(s({})).toBe("Sent");
    expect(s({ netPaidMinor: 400 })).toBe("Partially paid");
    expect(s({ today: "2026-12-27" })).toBe("Overdue · 12d");
    expect(s({ netPaidMinor: 1000, today: "2026-12-27" })).toBe("Paid");
  });
});

describe("numbering", () => {
  it("formats tokens", () => {
    expect(formatInvoiceNumber("{seq:3}", 188, "2026-12-01")).toBe("188");
    expect(formatInvoiceNumber("{seq:3}", 5, "2026-12-01")).toBe("005");
    expect(formatInvoiceNumber("INV-{YYYY}-{seq:4}", 42, "2026-12-01")).toBe("INV-2026-0042");
    expect(formatInvoiceNumber("{YY}/{seq}", 7, "2026-12-01")).toBe("26/7");
    expect(validateNumberFormat("INV-{seq}", "yearly")).not.toBeNull();
  });
});

describe("parsing", () => {
  it("durations", () => {
    expect(parseDuration("1.5")).toBe(5400);
    expect(parseDuration("1h30")).toBe(5400);
    expect(parseDuration("90m")).toBe(5400);
    expect(parseDuration("1:30")).toBe(5400);
    expect(parseDuration("x")).toBeNull();
  });
  it("times", () => {
    expect(parseTimeOfDay("9")).toBe("09:00");
    expect(parseTimeOfDay("930")).toBe("09:30");
    expect(parseTimeOfDay("9:30p")).toBe("21:30");
    expect(parseTimeOfDay("12am")).toBe("00:00");
    expect(parseTimeOfDay("25")).toBeNull();
  });
  it("money", () => {
    expect(parseMoney("1,234.5", "USD")).toBe(123450);
    expect(parseMoney("90", "EUR")).toBe(9000);
    expect(parseMoney("1.234", "USD")).toBeNull();
    expect(parseMoney("8000", "JPY")).toBe(8000);
  });
});

describe("time zones", () => {
  it("entry date in its own zone", () => {
    expect(toLocalDate("2026-11-23T23:30:00Z", "Europe/Berlin")).toBe("2026-11-24");
    expect(toLocalDate("2026-11-23T23:30:00Z", "America/New_York")).toBe("2026-11-23");
  });
  it("rejects a wall time skipped by DST", () => {
    const r = fromWallTime("2026-03-29", "02:30", "Europe/Berlin");
    expect(r.ok).toBe(false);
    const ok = fromWallTime("2026-11-23", "09:30", "Europe/Berlin");
    expect(ok.ok && ok.instant.toISOString()).toBe("2026-11-23T08:30:00.000Z");
  });
});

describe("fixed line", () => {
  it("whole vs part", () => {
    const common = { taskId: "t", projectName: "Brand", taskName: "Logo", currency: "EUR", feeMinor: 120000 };
    expect(buildFixedLine({ ...common, remainingMinor: 120000, amountMinor: 120000 }).detail).toBe("Fixed fee");
    expect(buildFixedLine({ ...common, remainingMinor: 120000, amountMinor: 60000 }).detail).toBe(
      "Part of €1,200.00 fixed fee · €600.00 remaining after this invoice",
    );
  });
});

describe("parallel timers (06 §2.10)", () => {
  const iv = (a: string, b: string) => ({ startedAt: `2026-11-23T${a}:00Z`, endedAt: `2026-11-23T${b}:00Z` });
  it("counts overlapping time once", () => {
    expect(coveredSeconds([iv("10:00", "11:00"), iv("10:00", "11:00")])).toBe(3600);
    expect(coveredSeconds([iv("10:00", "11:00"), iv("10:30", "12:00")])).toBe(7200);
  });
  it("adds disjoint and nested intervals", () => {
    expect(coveredSeconds([iv("13:00", "14:00"), iv("09:00", "10:00")])).toBe(7200);
    expect(coveredSeconds([iv("09:00", "12:00"), iv("10:00", "11:00")])).toBe(10800);
    expect(coveredSeconds([])).toBe(0);
  });
});
