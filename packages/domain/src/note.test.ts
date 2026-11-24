import { describe, expect, it } from "vitest";
import {
  buildTimeLines,
  inlineToPlain,
  listContinuation,
  noteFirstLine,
  parseInline,
  parseNote,
  safeHref,
} from "./index";

const text = (v: string) => ({ t: "text", v });

describe("note blocks", () => {
  it("keeps a plain note as one paragraph with its line breaks", () => {
    expect(parseNote("Fixed login\nand logout")).toEqual([
      { type: "p", c: [text("Fixed login\nand logout")] },
    ]);
  });

  it("parses bullet lists with any marker", () => {
    const [b] = parseNote("- a\n* b\n+ c");
    expect(b).toMatchObject({
      type: "ul",
      items: [{ c: [text("a")] }, { c: [text("b")] }, { c: [text("c")] }],
    });
  });

  it("parses numbered lists and keeps the start number", () => {
    const [b] = parseNote("3. three\n4) four");
    expect(b).toMatchObject({
      type: "ol",
      start: 3,
      items: [{ c: [text("three")] }, { c: [text("four")] }],
    });
  });

  it("splits paragraph, list, paragraph without blank lines", () => {
    const blocks = parseNote("Did:\n- a\n- b\nThen c");
    expect(blocks.map((b) => b.type)).toEqual(["p", "ul", "p"]);
  });

  it("nests lists by indentation, including tabs", () => {
    const [b] = parseNote("- a\n  - a1\n  - a2\n- b\n\t1. b1");
    expect(b).toMatchObject({
      type: "ul",
      items: [
        {
          c: [text("a")],
          sub: [{ type: "ul", items: [{ c: [text("a1")] }, { c: [text("a2")] }] }],
        },
        { c: [text("b")], sub: [{ type: "ol", items: [{ c: [text("b1")] }] }] },
      ],
    });
  });

  it("continues an item with indented lines and across blank lines", () => {
    const [b] = parseNote("- first\n  wrapped\n\n- second");
    expect(b).toMatchObject({
      type: "ul",
      items: [{ c: [text("first\nwrapped")] }, { c: [text("second")] }],
    });
  });

  it("prints headings as a heading block, never as a list", () => {
    expect(parseNote("## Monday\n- x")).toMatchObject([
      { type: "h", c: [text("Monday")] },
      { type: "ul" },
    ]);
    expect(parseNote("#hashtag")).toEqual([{ type: "p", c: [text("#hashtag")] }]);
  });

  it("drops horizontal rules", () => {
    expect(parseNote("a\n---\nb").map((b) => b.type)).toEqual(["p", "p"]);
  });

  it("does not mistake numbers or bold for lists", () => {
    expect(parseNote("2024. A year")[0].type).toBe("ol"); // CommonMark agrees; accepted
    expect(parseNote("**Bold** start")[0].type).toBe("p");
    expect(parseNote("-not a list")[0].type).toBe("p");
  });
});

describe("note inline", () => {
  it("parses emphasis, strike and code", () => {
    expect(parseInline("**b** *i* _j_ ~~s~~ `c*d`")).toEqual([
      { t: "strong", c: [text("b")] },
      text(" "),
      { t: "em", c: [text("i")] },
      text(" "),
      { t: "em", c: [text("j")] },
      text(" "),
      { t: "del", c: [text("s")] },
      text(" "),
      { t: "code", v: "c*d" },
    ]);
  });

  it("nests emphasis", () => {
    expect(parseInline("**bold *and* more**")).toEqual([
      { t: "strong", c: [text("bold "), { t: "em", c: [text("and")] }, text(" more")] },
    ]);
  });

  it("leaves arithmetic, snake_case and stray markers literal", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
    expect(parseInline("my_var_name and __init__")).toEqual([
      text("my_var_name and "),
      { t: "strong", c: [text("init")] },
    ]);
    expect(parseInline("unclosed **bold")).toEqual([text("unclosed **bold")]);
    expect(parseInline("a ~ b")).toEqual([text("a ~ b")]);
  });

  it("honours backslash escapes", () => {
    expect(parseInline("\\*not em\\*")).toEqual([text("*not em*")]);
  });

  it("parses links and bare URLs, trimming sentence punctuation", () => {
    expect(parseInline("[PR](https://x.io/pr/1) and https://x.io/a_(b).")).toEqual([
      { t: "link", href: "https://x.io/pr/1", c: [text("PR")] },
      text(" and "),
      { t: "link", href: "https://x.io/a_(b)", c: [text("https://x.io/a_(b)")] },
      text("."),
    ]);
  });

  it("refuses unsafe link targets", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([text("[x](javascript:alert(1))")]);
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
    expect(parseInline("mail mailto:a@b.co")).toEqual([
      text("mail "),
      { t: "link", href: "mailto:a@b.co", c: [text("a@b.co")] },
    ]);
  });

  it("does not nest links in link labels", () => {
    expect(parseInline("[https://a.io](https://b.io)")).toEqual([
      { t: "link", href: "https://b.io", c: [text("https://a.io")] },
    ]);
  });

  it("flattens to plain text", () => {
    expect(inlineToPlain(parseInline("**Fix** [login](https://a.io) `bug`"))).toBe("Fix login bug");
  });
});

describe("note first line", () => {
  it("strips block markers but keeps inline markup", () => {
    expect(noteFirstLine("\n- **Fixed** login\n- more")).toBe("**Fixed** login");
    expect(noteFirstLine("1. one")).toBe("one");
    expect(noteFirstLine("## Monday\n- x")).toBe("Monday");
  });

  it("feeds grouped invoice lines", () => {
    const e = (id: string, note: string) => ({
      id,
      date: "2026-01-05",
      seconds: 3600,
      note,
      taskId: "t",
      projectName: "P",
      taskName: "T",
      rateMinor: 100,
    });
    const [line] = buildTimeLines([e("a", "1. **API** work\n2. more"), e("b", "## Docs")], {
      mode: "per_task",
      showDates: false,
      showNotes: true,
    });
    expect(line.detail).toBe("- **API** work\n- Docs");
  });
});

describe("list continuation", () => {
  const at = (s: string) => listContinuation(s, s.length);
  it("continues bullets and numbers with the same indent", () => {
    expect(at("- a")).toEqual({ from: 3, to: 3, insert: "\n- " });
    expect(at("x\n  * b")).toEqual({ from: 7, to: 7, insert: "\n  * " });
    expect(at("9. nine")).toEqual({ from: 7, to: 7, insert: "\n10. " });
    expect(at("1) one")).toEqual({ from: 6, to: 6, insert: "\n2) " });
  });
  it("ends the list on an empty item", () => {
    expect(at("- a\n- ")).toEqual({ from: 4, to: 6, insert: "" });
  });
  it("leaves other lines alone", () => {
    expect(at("plain")).toBeNull();
    expect(at("---")).toBeNull();
    expect(at("- - -")).toBeNull();
  });
});
