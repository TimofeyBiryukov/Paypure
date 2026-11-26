import { execFileSync } from "node:child_process";

/**
 * Paydirt invoice PDFs (docs/paypure/05 §3.9). `pdftotext -layout` keeps Paydirt's columns, so the
 * parser reads fixed regions: the From and Billed To columns, the summary, the line table, the
 * totals and the payment block. Pass 2 checked it on all 173 invoices: every total equals its lines.
 */

export interface PdfLine {
  /** "Oct 3, 2026" titles → "2026-10-03"; null for undated lines */
  date: string | null;
  /** the title without its date: "pith.science – General development…" */
  title: string;
  detail: string;
  qtyHundredths: number;
  rateMinor: number;
  amountMinor: number;
}

export interface PdfFrom {
  businessName: string;
  senderName: string;
  address: string;
  phone: string;
  email: string;
}

export interface PdfInvoice {
  number: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  from: PdfFrom;
  /** Billed To column, top to bottom: name, contact, then address/contract lines */
  billedTo: string[];
  summary: string;
  lines: PdfLine[];
  subtotalMinor: number;
  totalMinor: number;
  /** Payment details block, one entry per printed line, totals column removed */
  payment: string[];
}

export function pdfText(path: string): string {
  return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function paydirtDate(s: string): string {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(s.trim());
  const mi = m ? MONTHS.indexOf(m[1]) : -1;
  if (!m || mi < 0) throw new Error(`not a Paydirt date: "${s}"`);
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

const minor = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);

const ROW = /^(.*?)\s+(-?\d+(?:\.\d+)?)\s+-?\$?(-?[\d,]+\.\d{2}) ([A-Z]{3})\s+-?\$?(-?[\d,]+\.\d{2}) ([A-Z]{3})\s*$/;
const TABLE_HEADER = /Description\s+Qty\s+Rate\s+Amount/;
const DATED = /^([A-Z][a-z]{2} \d{1,2}, \d{4}) – (.+)$/;
const indent = (l: string) => l.length - l.trimStart().length;

/** Drop leading/trailing blank lines, collapse runs of blanks, remove the common indentation. */
function block(raw: string[]): string {
  const lines = [...raw];
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const ind = Math.min(...lines.filter((l) => l.trim()).map(indent));
  const out: string[] = [];
  for (const l of lines) {
    if (!l.trim()) {
      if (out[out.length - 1] !== "") out.push("");
    } else out.push(l.slice(Number.isFinite(ind) ? ind : 0).trimEnd());
  }
  return out.join("\n");
}

export function parseInvoiceText(text: string, number: string): PdfInvoice {
  const lines = text.replace(/\f/g, "").split("\n");
  const fail = (msg: string): never => {
    throw new Error(`invoice ${number}: ${msg}`);
  };

  const header = lines.findIndex((l) => l.includes("Billed To"));
  if (header < 0) fail("no Billed To header");
  const col = lines[header].indexOf("Billed To");
  const desc = lines.findIndex((l) => TABLE_HEADER.test(l));
  if (desc < 0) fail("no line table");
  // The From column ends with its Email line (at the left margin, unlike a client's "Email:").
  const fromEnd = lines.findIndex((l, i) => i > header && i < desc && l.trimStart().startsWith("Email:") && indent(l) < col / 2);
  if (fromEnd < 0) fail("no Email line in the From column");

  const numberMatch = /#(\S+)/.exec(lines.slice(0, header + 1).join("\n"));
  if (numberMatch?.[1] !== number) fail(`the PDF says #${numberMatch?.[1]}`);
  const issued = /Issued\s+([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(text);
  const due = /Due\s+([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(text);
  if (!issued || !due) fail("no issue or due date");

  // From: business, sender, "Address:", address lines…, "Phone: …", "Email: …"
  const left = lines
    .slice(header + 1, fromEnd + 1)
    .map((l) => l.slice(0, col).trim())
    .filter(Boolean);
  const field = (label: string) => left.find((l) => l.startsWith(`${label}:`))?.slice(label.length + 1).trim() ?? "";
  const addrStart = left.indexOf("Address:");
  const addrEnd = left.findIndex((l) => l.startsWith("Phone:") || l.startsWith("Email:"));
  const from: PdfFrom = {
    businessName: left[0] ?? "",
    senderName: left[1] && left[1] !== "Address:" ? left[1] : "",
    address: addrStart >= 0 ? left.slice(addrStart + 1, addrEnd < 0 ? undefined : addrEnd).join("\n") : "",
    phone: field("Phone"),
    email: field("Email"),
  };

  // Billed To: the column right of `col`, minus the Issued/Due/number column. Below the From
  // block, a line belongs to the column only if nothing sits left of it (else it's the summary).
  const billedTo: string[] = [];
  const summary: string[] = [];
  for (let i = header + 1; i < desc; i++) {
    const l = lines[i];
    const leftPart = l.slice(0, col).trim();
    if (i > fromEnd && leftPart) {
      summary.push(l.trim());
      continue;
    }
    let seg = l.slice(col);
    seg = seg.replace(/\s{2,}(Issued|Due|Invoice number)\b.*$/, "");
    seg = seg.trim().split(/\s{3,}/)[0] ?? "";
    if (seg && !/^(Issued|Due|Invoice number)\b/.test(seg)) billedTo.push(seg);
  }

  // Line table: a numeric row (qty, rate, amount) opens an item. The title is the text on that
  // row plus the lines right after it; the note follows after a blank line.
  const totalsAt = lines.findIndex((l, i) => i > desc && /\bSubtotal\s+-?\$?[\d,]+\.\d{2} [A-Z]{3}/.test(l));
  if (totalsAt < 0) fail("no Subtotal");
  type Open = { row: RegExpExecArray; title: string[]; detail: string[]; inDetail: boolean };
  const items: Open[] = [];
  let cur: Open | null = null;
  for (let i = desc + 1; i < totalsAt; i++) {
    const l = lines[i];
    if (TABLE_HEADER.test(l)) continue;
    const m = ROW.exec(l);
    if (m) {
      cur = { row: m, title: m[1].trim() ? [m[1].trim()] : [], detail: [], inDetail: false };
      items.push(cur);
      continue;
    }
    if (!cur) {
      if (l.trim()) fail(`text before the first line: "${l.trim()}"`);
      continue;
    }
    if (!cur.inDetail) {
      if (l.trim()) cur.title.push(l.trim());
      else if (cur.title.length) cur.inDetail = true;
    } else cur.detail.push(l);
  }
  const currencies = new Set<string>();
  const parsed: PdfLine[] = items.map((it) => {
    currencies.add(it.row[4]);
    currencies.add(it.row[6]);
    const full = it.title.join(" ");
    const dated = DATED.exec(full);
    return {
      date: dated ? paydirtDate(dated[1]) : null,
      title: dated ? dated[2] : full,
      detail: block(it.detail),
      qtyHundredths: Math.round(Number(it.row[2]) * 100),
      rateMinor: minor(it.row[3]),
      amountMinor: minor(it.row[5]),
    };
  });
  if (currencies.size !== 1) fail(`lines in ${currencies.size} currencies`);

  const tail = lines.slice(totalsAt).join("\n");
  const sub = /\bSubtotal\s+-?\$?([\d,]+\.\d{2}) ([A-Z]{3})/.exec(tail);
  const tot = /(?<!Sub)Total\s+-?\$?([\d,]+\.\d{2}) ([A-Z]{3})/.exec(tail);
  if (!sub || !tot) fail("no Subtotal or Total");

  const payAt = lines.findIndex((l, i) => i >= totalsAt && l.trim().startsWith("Payment details"));
  const payment =
    payAt < 0
      ? []
      : lines
          .slice(payAt + 1)
          .map((l) => l.replace(/\s{2,}(Sub)?[Tt]otal\s+-?\$.*$/, "").trim())
          .filter(Boolean);

  return {
    number,
    issueDate: paydirtDate((issued as RegExpExecArray)[1]),
    dueDate: paydirtDate((due as RegExpExecArray)[1]),
    currency: [...currencies][0],
    from,
    billedTo,
    summary: summary.join(" "),
    lines: parsed,
    subtotalMinor: minor((sub as RegExpExecArray)[1]),
    totalMinor: minor((tot as RegExpExecArray)[1]),
    payment,
  };
}

/**
 * The payment block as a structured snapshot, best effort: the sheet shows these fields, while the
 * original PDF stays the document of record. Lines it can't place go to `instructions`.
 */
export function paymentSnapshot(block: string[], currency: string) {
  const snap = {
    label: "",
    currency,
    beneficiaryName: "",
    beneficiaryAddress: "",
    bankName: "",
    bankAddress: "",
    accountNumber: null as string | null,
    iban: null as string | null,
    swiftBic: null as string | null,
    routingNumber: null as string | null,
    correspondentBankName: null as string | null,
    correspondentAccount: null as string | null,
    correspondentSwift: null as string | null,
    referenceHint: null as string | null,
    instructions: null as string | null,
  };
  type Key = keyof typeof snap;
  const extra: string[] = [];
  // The field a continuation line belongs to (the previous labelled line), and fields that
  // the next unlabelled lines fill in order ("Bank:" → name, address).
  const st: { last: Key | null; expect: Key[] } = { last: null, expect: [] };
  const set = (k: Key, v: string) => {
    const prev = snap[k];
    (snap as Record<Key, string | null>)[k] = prev ? `${prev} ${v}` : v;
    st.last = k;
  };
  // Labelled lines, first match wins. A rule with a guard applies only while the guard holds.
  const rules: [RegExp, (m: RegExpExecArray) => void, (() => boolean)?][] = [
    [/^NOTE:\s*(.*)$/i, (m) => set("instructions", m[1])],
    [
      /^paypal:\s*(.*)$/i,
      (m) => {
        set("instructions", `PayPal: ${m[1]}`);
        snap.label = "PayPal";
      },
    ],
    [/^SWIFT(?:\/BIC)?:\s*(\S+)$/, (m) => set("swiftBic", m[1]), () => !snap.swiftBic],
    [/^Account Number(?: \([A-Z]{3}\))?:\s*(\S+?);?$/i, (m) => set("accountNumber", m[1])],
    [/^IBAN:\s*(.+)$/, (m) => set("iban", m[1].replace(/\s+/g, ""))],
    [/^(?:Beneficiary Bank|Bank name):\s*(.*)$/i, (m) => set("bankName", m[1])],
    [/^Bank address:\s*(.*)$/i, (m) => set("bankAddress", m[1])],
    [/^(?:Beneficiary|Receiver|Company Name):\s*(.*)$/i, (m) => set("beneficiaryName", m[1])],
    [/^(?:Beneficiary Address|Receiver address):\s*(.*)$/i, (m) => set("beneficiaryAddress", m[1])],
    [
      /^Correspondent(?:s| Bank[^:]*):\s*(.*)$/i,
      (m) => {
        if (m[1]) set("correspondentBankName", m[1]);
        else st.last = "correspondentBankName";
      },
    ],
    [
      /^Bank:$/,
      () => {
        st.expect = ["bankName", "bankAddress"];
      },
    ],
    [
      /^Name on Account:$/,
      () => {
        st.expect = ["beneficiaryName"];
      },
    ],
  ];
  for (const raw of block) {
    const l = raw.trim();
    const hit = rules.some(([re, fn, guard]) => {
      const m = re.exec(l);
      if (!m || (guard && !guard())) return false;
      fn(m);
      return true;
    });
    if (hit) continue;
    if (st.expect.length) set(st.expect.shift() as Key, l);
    else if (st.last && !["swiftBic", "accountNumber", "iban"].includes(st.last)) set(st.last, l);
    else extra.push(l);
  }
  if (extra.length) snap.instructions = [snap.instructions, ...extra].filter(Boolean).join(" · ");
  // "Bank X (BX), 1 Some Avenue, City, SWIFT/BIC: ABCD" → name, address (SWIFT is its own field)
  const bank = snap.bankName.replace(/,?\s*SWIFT(?:\/BIC)?:\s*\S+$/, "");
  if (!snap.bankAddress && bank.includes(", ")) {
    snap.bankName = bank.slice(0, bank.indexOf(", "));
    snap.bankAddress = bank.slice(bank.indexOf(", ") + 2);
  } else snap.bankName = bank;
  // "№ 123 held with BANK, N.Y., SWIFT/BIC: ABCD" or "Bank, N.A. New York, USA, SWIFT - ABCD"
  const corr = snap.correspondentBankName ?? "";
  const held = /^№\s*(\S+)\s+held with\s+(.+?),?\s*SWIFT(?:\/BIC)?:\s*(\S+)$/.exec(corr);
  const plain = /^([^\d].+?),?\s*SWIFT\s*-\s*(\S+)$/.exec(corr);
  if (held) {
    snap.correspondentAccount = held[1];
    snap.correspondentBankName = held[2];
    snap.correspondentSwift = held[3];
  } else if (plain && !/\b2\.\s/.test(corr)) {
    snap.correspondentBankName = plain[1];
    snap.correspondentSwift = plain[2];
  }
  if (!snap.label) snap.label = snap.bankName.split(/[,(]/)[0].trim() || "Bank transfer";
  return snap;
}
