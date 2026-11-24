import {
  type Inline,
  listContinuation,
  type NoteBlock,
  type NoteList,
  parseInline,
  parseNote,
} from "@paypure/domain";
import type { KeyboardEvent, ReactNode } from "react";

/**
 * Renders the note Markdown subset (Guide §5.13, parser in @paypure/domain). One renderer for the
 * app and the invoice sheet; the sheet is also the PDF, so `print` spells out each link's URL
 * next to its label (paper has no hover) while keeping the link clickable in the PDF.
 * Everything is rendered as React text nodes: nothing in a note becomes HTML.
 */
export function NoteMarkdown({
  text,
  print = false,
  className = "",
}: {
  text: string;
  print?: boolean;
  className?: string;
}) {
  return <div className={`note-md ${className}`}>{renderBlocks(parseNote(text), print)}</div>;
}

/** One line of inline Markdown (previews, e.g. the time list's first line). */
export function NoteInline({ text }: { text: string }) {
  return <>{renderInline(parseInline(text), false)}</>;
}

function renderBlocks(blocks: NoteBlock[], print: boolean): ReactNode {
  return blocks.map((b, i) => {
    // biome-ignore-start lint/suspicious/noArrayIndexKey: static render of parsed text
    if (b.type === "p") return <p key={i}>{renderInline(b.c, print)}</p>;
    if (b.type === "h")
      return (
        <p key={i} className="note-h">
          {renderInline(b.c, print)}
        </p>
      );
    return renderList(b, print, i);
    // biome-ignore-end lint/suspicious/noArrayIndexKey: static render of parsed text
  });
}

function renderList(l: NoteList, print: boolean, key: number): ReactNode {
  const items = l.items.map((it, j) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: static render of parsed text
    <li key={j}>
      {renderInline(it.c, print)}
      {it.sub.map((s, k) => renderList(s, print, k))}
    </li>
  ));
  return l.type === "ol" ? (
    <ol key={key} start={l.start === 1 ? undefined : l.start}>
      {items}
    </ol>
  ) : (
    <ul key={key}>{items}</ul>
  );
}

function renderInline(c: Inline[], print: boolean): ReactNode {
  // biome-ignore lint/suspicious/noArrayIndexKey: static render of parsed text
  return c.map((n, i) => <InlineNode key={i} n={n} print={print} />);
}

function InlineNode({ n, print }: { n: Inline; print: boolean }): ReactNode {
  if (n.t === "text") return n.v;
  if (n.t === "code") return <code>{n.v}</code>;
  if (n.t !== "link") {
    const Tag = n.t; // strong · em · del
    return <Tag>{renderInline(n.c, print)}</Tag>;
  }
  const shown = n.href.replace(/^mailto:/i, "");
  const plain = n.c.length === 1 && n.c[0].t === "text" ? n.c[0].v : null;
  return (
    <>
      <a href={n.href} target="_blank" rel="noopener noreferrer nofollow">
        {renderInline(n.c, print)}
      </a>
      {print && plain !== n.href && plain !== shown && <span className="note-url"> ({shown})</span>}
    </>
  );
}

/**
 * Keydown for note textareas: Enter continues a Markdown list (or ends it on an empty item).
 * Edits go through `insertText` so the browser's undo still works.
 */
export function continueNoteList(e: KeyboardEvent<HTMLTextAreaElement>): void {
  if (
    e.key !== "Enter" ||
    e.shiftKey ||
    e.altKey ||
    e.metaKey ||
    e.ctrlKey ||
    e.nativeEvent.isComposing
  )
    return;
  const el = e.currentTarget;
  if (el.selectionStart !== el.selectionEnd) return;
  const edit = listContinuation(el.value, el.selectionStart);
  if (!edit) return;
  e.preventDefault();
  el.setSelectionRange(edit.from, edit.to);
  const ok = edit.insert
    ? document.execCommand("insertText", false, edit.insert)
    : document.execCommand("delete");
  if (!ok) {
    el.setRangeText(edit.insert, edit.from, edit.to, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
