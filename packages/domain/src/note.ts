/**
 * Light Markdown subset for notes (Guide §5.13). Notes are work logs typed into the timer and the
 * entry panel; they print on invoices, so the subset is small and nothing a note contains can
 * change the sheet's layout or run code:
 *
 * - Blocks: paragraphs (single line breaks kept), `-`/`*`/`+` bullet lists, `1.`/`1)` numbered
 *   lists, nesting by indentation, and `#` headings (printed as a bold line, never large).
 * - Inline: `**bold**`/`__bold__`, `*italic*`/`_italic_`, `~~strike~~`, `` `code` ``,
 *   `[label](url)` and bare `http(s)://` URLs. Backslash escapes a marker.
 * - Links only to http(s) and mailto. Anything else prints literally, as does every other syntax.
 *
 * The parser is pure and shared by the app and the invoice sheet (which is also the PDF).
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export interface NoteListItem {
  c: Inline[];
  /** Nested lists under this item. */
  sub: NoteList[];
}

export interface NoteList {
  type: "ul" | "ol";
  /** First number of an ordered list. */
  start: number;
  items: NoteListItem[];
}

export type NoteBlock = { type: "p"; c: Inline[] } | { type: "h"; c: Inline[] } | NoteList;

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const RULE_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/** Visual width of leading whitespace; a tab counts as 4 (users paste from editors). */
function indentOf(s: string): number {
  let n = 0;
  for (const ch of s) n += ch === "\t" ? 4 - (n % 4) : 1;
  return n;
}

export function parseNote(note: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let para: string[] = [];
  // Open lists, outermost first. `indent` is the marker's column, `content` where text starts;
  // `lines` is the source text of the list's last item, parsed when the item closes.
  const stack: { list: NoteList; indent: number; content: number; lines: string[] }[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  const flushItem = (e: (typeof stack)[number]) => {
    if (!e.lines.length) return;
    e.list.items[e.list.items.length - 1].c = parseInline(e.lines.join("\n"));
    e.lines = [];
  };
  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      const e = stack.pop();
      if (e) flushItem(e);
    }
  };
  const openList = (type: NoteList["type"], marker: string, indent: number, content: number) => {
    const list: NoteList = {
      type,
      start: type === "ol" ? Number.parseInt(marker, 10) : 1,
      items: [],
    };
    const parent = stack[stack.length - 1];
    if (parent) {
      flushItem(parent);
      parent.list.items[parent.list.items.length - 1].sub.push(list);
    } else blocks.push(list);
    stack.push({ list, indent, content, lines: [] });
  };

  for (const raw of note.replace(/\r\n?/g, "\n").split("\n")) {
    if (raw.trim() === "") {
      // A blank line ends a paragraph. Lists carry on if the next line is an item or indented.
      flushPara();
      continue;
    }
    const m = raw.match(LIST_RE);
    if (m && !RULE_RE.test(raw)) {
      flushPara();
      const indent = indentOf(m[1]);
      const marker = m[2];
      const type: NoteList["type"] = /\d/.test(marker) ? "ol" : "ul";
      const content = indent + marker.length + 1;
      // Close lists nested deeper than this item.
      while (stack.length && indent < stack[stack.length - 1].indent) closeTo(stack.length - 1);
      const top = stack[stack.length - 1];
      if (top && indent >= top.content) {
        openList(type, marker, indent, content); // nested under the previous item
      } else if (top && top.list.type === type) {
        flushItem(top); // a sibling
        top.content = content;
      } else {
        closeTo(Math.max(0, stack.length - 1)); // a different kind of list at the same level
        openList(type, marker, indent, content);
      }
      const cur = stack[stack.length - 1];
      cur.list.items.push({ c: [], sub: [] });
      cur.lines.push(m[3]);
      continue;
    }
    if (stack.length) {
      // An indented line continues the innermost item it is indented under. An unindented line
      // ends the list: work logs often go "- a\n- b\nThen c".
      const indent = indentOf(raw.match(/^\s*/)?.[0] ?? "");
      let depth = stack.length;
      while (depth > 0 && indent < Math.min(stack[depth - 1].content, 2)) depth--;
      closeTo(depth);
      const top = stack[stack.length - 1];
      if (top && top.list.items[top.list.items.length - 1].sub.length === 0) {
        top.lines.push(raw.trim());
        continue;
      }
      closeTo(0);
    }
    const h = raw.match(HEADING_RE);
    if (h && !RULE_RE.test(raw)) {
      flushPara();
      if (h[1]) blocks.push({ type: "h", c: parseInline(h[1]) });
      continue;
    }
    if (RULE_RE.test(raw)) {
      flushPara(); // a horizontal rule has no place on an invoice line: a paragraph break
      continue;
    }
    para.push(raw.trim());
  }
  closeTo(0);
  flushPara();
  return blocks;
}

// ---------------------------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------------------------

const ESCAPABLE = "\\`*_~[]()#+-.!>";
const URL_RE = /^(?:https?:\/\/|mailto:)[^\s<>]+/i;

/** Only links that are safe to open from an invoice: http(s) and mailto. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\/[^\s<>"]+$/i.test(h)) return h;
  if (/^mailto:[^\s<>"@]+@[^\s<>"]+$/i.test(h)) return h;
  return null;
}

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Trailing punctuation belongs to the sentence, not the URL; keep balanced parentheses. */
function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (/[.,;:!?'"*_~]/.test(last)) u = u.slice(0, -1);
    else if (last === ")" && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0))
      u = u.slice(0, -1);
    else return u;
  }
}

/** Find the closing delimiter for emphasis opened at `from`, or -1. */
function findCloser(s: string, d: string, from: number): number {
  for (let j = s.indexOf(d, from); j !== -1; j = s.indexOf(d, j + 1)) {
    if (j === from) continue; // empty content
    if (s[j - 1] === "\\") continue;
    if (isSpace(s[j - 1])) continue;
    if (d.length === 1 && (s[j + 1] === d || s[j - 1] === d)) {
      // Part of a double marker; skip past it.
      if (s[j + 1] === d) j++;
      continue;
    }
    if (d[0] === "_" && isWord(s[j + d.length])) continue;
    return j;
  }
  return -1;
}

export function parseInline(s: string, links = true): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const push = (n: Inline) => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
    out.push(n);
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (s[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const end = s.indexOf(fence, i + n);
      if (end > i + n && !s.slice(i + n, end).includes("\n")) {
        push({ t: "code", v: s.slice(i + n, end) });
        i = end + n;
        continue;
      }
      buf += fence;
      i += n;
      continue;
    }
    if (links && ch === "[") {
      const m = /^\[([^\]\n]+)\]\(\s*<?([^()\s<>]+(?:\([^()\s]*\))?)>?\s*\)/.exec(s.slice(i));
      const href = m && safeHref(m[2]);
      if (m && href) {
        push({ t: "link", href, c: parseInline(m[1], false) });
        i += m[0].length;
        continue;
      }
    }
    if (links && (ch === "h" || ch === "H" || ch === "m" || ch === "M") && !isWord(s[i - 1])) {
      const m = URL_RE.exec(s.slice(i));
      if (m) {
        const url = trimUrl(m[0]);
        const href = safeHref(url);
        if (href && url.length > url.indexOf(":") + 3) {
          push({ t: "link", href, c: [{ t: "text", v: url.replace(/^mailto:/i, "") }] });
          i += url.length;
          continue;
        }
      }
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const d2 = s.slice(i, i + 2);
      const candidates = ch === "~" ? ["~~"] : d2 === ch + ch ? [d2, ch] : [ch];
      let matched = false;
      for (const d of candidates) {
        if (d.length === 2 && d2 !== d) continue;
        const after = s[i + d.length];
        if (isSpace(after)) continue;
        if (ch === "_" && isWord(s[i - 1])) continue; // snake_case stays literal
        const j = findCloser(s, d, i + d.length);
        if (j === -1) continue;
        const inner = s.slice(i + d.length, j);
        const t = ch === "~" ? "del" : d.length === 2 ? "strong" : "em";
        push({ t, c: parseInline(inner, links) });
        i = j + d.length;
        matched = true;
        break;
      }
      if (matched) continue;
      // Not emphasis: keep a run of the same marker literal so it isn't re-tried piecemeal.
      let n = 1;
      while (s[i + n] === ch) n++;
      buf += s.slice(i, i + n);
      i += n;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf) out.push({ t: "text", v: buf });
  return out;
}

/** Plain text of inline content (links as their label). */
export function inlineToPlain(c: Inline[]): string {
  return c.map((n) => (n.t === "text" || n.t === "code" ? n.v : inlineToPlain(n.c))).join("");
}

/**
 * The note's first non-empty line as inline Markdown, with block markers (bullet, number,
 * heading) removed. Used for one-line previews and grouped invoice lines.
 */
export function noteFirstLine(note: string): string {
  const line = note.split(/\r?\n/).find((l) => l.trim() && !RULE_RE.test(l)) ?? "";
  return line.replace(LIST_RE, "$3").replace(HEADING_RE, "$1").trim();
}

/** Count of non-empty lines after the first (for the "+N lines" expander). */
export function noteExtraLines(note: string): number {
  return Math.max(0, note.split(/\r?\n/).filter((l) => l.trim()).length - 1);
}

/**
 * Enter inside a list item in the note field (Screens 03, Note): continue the list with the next
 * marker, or, on an empty item, remove the marker to end the list. Returns the text to put in
 * place of `value.slice(from, to)`, or null to let Enter insert a plain line break.
 */
export function listContinuation(
  value: string,
  caret: number,
): { from: number; to: number; insert: string } | null {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const m = /^(\s*)(?:([-*+])|(\d{1,9})([.)]))(\s+)(.*)$/.exec(value.slice(lineStart, caret));
  if (!m || RULE_RE.test(value.slice(lineStart, caret))) return null;
  const lineEnd = value.indexOf("\n", caret);
  const rest = value.slice(caret, lineEnd === -1 ? value.length : lineEnd);
  if (m[6].trim() === "" && rest.trim() === "") return { from: lineStart, to: caret, insert: "" };
  const marker = m[2] ?? `${Number.parseInt(m[3], 10) + 1}${m[4]}`;
  return { from: caret, to: caret, insert: `\n${m[1]}${marker}${m[5]}` };
}
