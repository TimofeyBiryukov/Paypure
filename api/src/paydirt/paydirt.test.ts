import { describe, expect, it } from "vitest";
import { parseCsv, readTimeLog } from "./csv";
import { parseInvoiceText, paymentSnapshot } from "./pdf";
import { buildPlan, type Overrides, slug } from "./plan";

// Synthetic data only: the real export stays in data/ (git-ignored).

const row = (left: string, mid = "", right = "") => `${left.padEnd(56)}${mid.padEnd(50)}${right}`.trimEnd();
const item = (qty: string, rate: string, amount: string) => `${"".padEnd(90)}${qty.padStart(6)}   $${rate} USD   $${amount} USD`;

const INVOICE = [
  "#007",
  "",
  row("From", "Billed To", "Invoice number   #007"),
  row("", "", "Issued    Nov 2, 2026"),
  row("Example Studio LLC", "Acme Co", ""),
  row("Jane Doe", "John Roe", "Due   Nov 9, 2026"),
  "",
  row("Address:", "For Contract №2"),
  "Main St. 1",
  "Springfield",
  "",
  "Phone: +100000000",
  "Email: jane@example.com",
  "",
  "",
  "Website work and Hosting",
  "",
  "",
  "  Description                                                                             Qty          Rate          Amount",
  "",
  item("1.50", "40.00", "60.00"),
  "  Oct 3, 2026 – Website – Development",
  "",
  "         Fixed the header",
  "         Deployed",
  "",
  "\fDescription                                                                               Qty          Rate       Amount",
  item("0.25", "40.00", "10.00"),
  "  Oct 5, 2026 – Website – Development (Scaled",
  "  Down)",
  "",
  "  Hosting for October           1.0   $20.00 USD   $20.00 USD",
  "",
  "                                                                                    Subtotal                    $90.00 USD",
  "Payment details",
  "",
  "NOTE: Leave the reference empty.                                                    Total                   $90.00 USD",
  "SWIFT: EXAMPLE1",
  "Account Number (USD): XX00000000000;",
  "Beneficiary Bank: Example Bank (EB), 1 Bank Avenue, City,",
  "Country, SWIFT/BIC: EXAMPLE1",
  "Beneficiary: Example Studio LLC",
  "Correspondent Bank in USD: № 12345 held with BIG BANK, N.Y., SWIFT/BIC: BIGBUS33",
].join("\n");

describe("paydirt csv", () => {
  it("reads quoted multi-line notes and doubled quotes", () => {
    expect(parseCsv('a,b\n1,"x\n""y"""\n2,\n')).toEqual([["a", "b"], ["1", 'x\n"y"'], ["2", ""]]);
  });

  it("reads 12h times, duration-only rows and missing trailing cells", () => {
    const head = "Start time,End time,Client,Project,Job,User,Description,Duration in hours,Hourly rate,Price,Invoiced in,Timesheet Approval Status";
    const rows = readTimeLog(`${head}\n2026-10-03 11:05pm,2026-10-04 12:35am,Acme Co,Website,Development,Jane,"- a\n- b",1.5,40.0,60.0,007\n2026-10-05,2026-10-05,Acme Co,Website,Development,Jane,"",0.25,40.0,10.0\n`);
    expect(rows[0]).toMatchObject({ startTime: "23:05", endDate: "2026-10-04", endTime: "00:35", note: "- a\n- b", hundredths: 150, rateMinor: 4000, invoicedIn: "007" });
    expect(rows[1]).toMatchObject({ startTime: null, hundredths: 25, invoicedIn: null });
  });
});

describe("paydirt invoice pdf", () => {
  const inv = parseInvoiceText(INVOICE, "007");

  it("reads the header, parties and summary", () => {
    expect(inv).toMatchObject({ issueDate: "2026-11-02", dueDate: "2026-11-09", currency: "USD", summary: "Website work and Hosting" });
    expect(inv.from).toEqual({ businessName: "Example Studio LLC", senderName: "Jane Doe", address: "Main St. 1\nSpringfield", phone: "+100000000", email: "jane@example.com" });
    expect(inv.billedTo).toEqual(["Acme Co", "John Roe", "For Contract №2"]);
  });

  it("reads dated, wrapped and same-row lines across a page break", () => {
    expect(inv.lines).toEqual([
      { date: "2026-10-03", title: "Website – Development", detail: "Fixed the header\nDeployed", qtyHundredths: 150, rateMinor: 4000, amountMinor: 6000 },
      { date: "2026-10-05", title: "Website – Development (Scaled Down)", detail: "", qtyHundredths: 25, rateMinor: 4000, amountMinor: 1000 },
      { date: null, title: "Hosting for October", detail: "", qtyHundredths: 100, rateMinor: 2000, amountMinor: 2000 },
    ]);
    expect(inv.totalMinor).toBe(9000);
  });

  it("splits the payment block into account fields", () => {
    expect(paymentSnapshot(inv.payment, "USD")).toMatchObject({
      instructions: "Leave the reference empty.",
      swiftBic: "EXAMPLE1",
      accountNumber: "XX00000000000",
      bankName: "Example Bank (EB)",
      bankAddress: "1 Bank Avenue, City, Country",
      beneficiaryName: "Example Studio LLC",
      correspondentAccount: "12345",
      correspondentBankName: "BIG BANK, N.Y.",
      correspondentSwift: "BIGBUS33",
    });
  });

  it("rejects a PDF whose number doesn't match its file", () => {
    expect(() => parseInvoiceText(INVOICE, "008")).toThrow(/says #007/);
  });
});

describe("paydirt plan", () => {
  const head = "Start time,End time,Client,Project,Job,User,Description,Duration in hours,Hourly rate,Price,Invoiced in,Timesheet Approval Status";
  const csv = (rows: string[]) => readTimeLog(`${head}\n${rows.join("\n")}\n`);
  const overrides: Overrides = {
    timeZone: "Asia/Almaty",
    nextNumber: 8,
    numberHoles: ["001", "002", "003", "004", "005", "006"],
    clients: { "Acme Co": { active: true, billingEmails: ["ap@acme.example"] } },
    staleUnbilled: { cutoff: "2026-01-01", default: { kind: "written_off", ref: "Paydirt cleanup" } },
  };
  const pdf = { folder: slug("Acme Co"), path: "/x/invoice_007.pdf", invoice: parseInvoiceText(INVOICE, "007") };
  const payments = [{ number: "007", status: "paid" as const, paidOn: "2026-11-10", amountMinor: 9000, note: "" }];

  it("claims entries, keeps Paydirt's duration, writes off stale time and matches renamed tasks", () => {
    const plan = buildPlan({
      rows: csv([
        // billed on 007; paused: 2 h span but 1.5 h logged
        "2026-10-03 10:00am,2026-10-03 12:00pm,Acme Co,Website,Development,Jane,note,1.5,40.0,60.0,007",
        // billed on 007 by its PDF line, though the log still shows it unbilled; task renamed since
        "2026-10-05 9:00am,2026-10-05 9:15am,Acme Co,Website,Development (Scaled Down) v2,Jane,,0.25,40.0,10.0,",
        // stale
        "2024-05-01 9:00am,2024-05-01 10:00am,Acme Co,Website,Development,Jane,,1.0,40.0,40.0,",
        // current, stays unbilled
        "2026-11-03 9:00am,2026-11-03 10:00am,Acme Co,Website,Development,Jane,,1.0,40.0,40.0,",
      ]),
      pdfs: [pdf],
      payments,
      overrides,
      today: "2026-11-25",
    });
    expect(plan.errors).toEqual([]);
    const [paused, renamed, stale, current] = plan.entries;
    expect(paused.durationSeconds).toBe(5400);
    expect((paused.endedAt as Date).getTime() - (paused.startedAt as Date).getTime()).toBe(5400_000);
    expect(renamed.invoiceNumber).toBe("007");
    expect(stale.off).toMatchObject({ kind: "written_off", ref: "Paydirt cleanup" });
    expect(current).toMatchObject({ invoiceNumber: null, off: null });
    const lines = plan.invoices[0].lines;
    expect(lines.map((l) => l.kind)).toEqual(["time", "time", "manual"]);
    expect(lines[1].taskKey).toBe(renamed.taskKey);
    expect(lines[1].title).toBe("Oct 5, 2026 – Website – Development (Scaled Down)");
    expect(plan.invoices[0].payment).toEqual({ paidOn: "2026-11-10", amountMinor: 9000, note: "" });
  });

  it("refuses a time log older than the invoices", () => {
    const plan = buildPlan({
      rows: csv(["2026-10-03 10:00am,2026-10-03 11:30am,Acme Co,Website,Development,Jane,,1.5,40.0,60.0,007"]),
      pdfs: [pdf],
      payments,
      overrides,
      today: "2026-11-25",
    });
    expect(plan.errors.join("\n")).toMatch(/Export the time log again/);
  });
});
