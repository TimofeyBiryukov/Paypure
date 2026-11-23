"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { startTimer } from "@/app/actions/timer";
import type { ActionState } from "@/lib/action";
import type { Catalog } from "@/lib/types";
import { useToast } from "./toaster";
import { ClientBadge } from "./ui";

type Item =
  | { kind: "go"; label: string; href: string; hint?: string }
  | { kind: "start"; label: string; taskId: string; sub: string; colour: number; client: string }
  | { kind: "log"; label: string; taskId: string; sub: string };

/**
 * ⌘K command palette (S17). The catalog is loaded once by the layout and filtered locally, so
 * search is instant (Tech §6.2). Starting a timer goes through the same Server Action.
 */
export function Palette({ catalog, isAdmin }: { catalog: Catalog; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();
  const push = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const taskInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const openEv = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener("pp:palette", openEv);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pp:palette", openEv);
    };
  }, []);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQ("");
      setActive(0);
    }
    if (!open && d.open) d.close();
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (s: string) => tokens.every((t) => s.toLowerCase().includes(t));
    const pages: Item[] = [
      { kind: "go", label: "Home", href: "/" },
      { kind: "go", label: "Time", href: "/time", hint: "Add entry" },
      { kind: "go", label: "Clients", href: "/clients" },
      ...(isAdmin
        ? ([
            { kind: "go", label: "Invoices", href: "/invoices" },
            { kind: "go", label: "New client", href: "/clients/new" },
            { kind: "go", label: "Settings", href: "/settings/business" },
          ] as Item[])
        : []),
      { kind: "go", label: "Add time entry", href: "/time?new=1" },
    ];
    const tasks = catalog.tasks
      .filter((t) => tokens.length > 0 && match(`${t.clientName} ${t.projectName} ${t.name}`))
      .slice(0, 6)
      .flatMap<Item>((t) => [
        {
          kind: "start",
          label: `Start timer on ${t.name}`,
          taskId: t.id,
          sub: `${t.clientName} / ${t.projectName}`,
          colour: t.colour,
          client: t.clientName,
        },
        {
          kind: "log",
          label: `Log time on ${t.name}`,
          taskId: t.id,
          sub: `${t.clientName} / ${t.projectName}`,
        },
      ]);
    const clients = catalog.clients
      .filter((c) => tokens.length > 0 && match(c.name))
      .slice(0, 4)
      .flatMap<Item>((c) => [
        { kind: "go", label: c.name, href: `/clients/${c.id}`, hint: "Client" },
        ...(isAdmin
          ? ([
              {
                kind: "go",
                label: `New invoice for ${c.name}`,
                href: `/invoices/new?client=${c.id}`,
              },
            ] as Item[])
          : []),
      ]);
    const filteredPages = pages.filter((p) => tokens.length === 0 || match(p.label));
    // Typing a task name offers Start and Log time directly (S17).
    return [...tasks, ...clients, ...filteredPages];
  }, [q, catalog, isAdmin]);

  const choose = (it: Item) => {
    if (it.kind === "go") {
      setOpen(false);
      router.push(it.href);
    } else if (it.kind === "log") {
      setOpen(false);
      router.push(`/time?new=1&task=${it.taskId}`);
    } else if (taskInput.current && formRef.current) {
      taskInput.current.value = it.taskId;
      formRef.current.requestSubmit();
    }
  };

  const onStart = async (fd: FormData) => {
    const r: ActionState = await startTimer(null, fd);
    setOpen(false);
    if (r?.ok) {
      window.dispatchEvent(
        new CustomEvent("pp:timer", { detail: (r.data as { timer?: unknown })?.timer ?? null }),
      );
      if (r.toast) push(r.toast);
    } else if (r?.error) push({ text: r.error, tone: "danger" });
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-icon hidden sm:inline-flex"
        aria-label="Command palette (⌘K)"
        title="⌘K"
        onClick={() => setOpen(true)}
      >
        <Search size={16} />
      </button>
      <dialog
        ref={dialog}
        className="dialog"
        style={{ marginTop: "12vh" }}
        onClose={() => setOpen(false)}
        aria-label="Command palette"
      >
        <form ref={formRef} action={onStart} className="contents">
          <input ref={taskInput} type="hidden" name="taskId" />
        </form>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (items[active]) choose(items[active]);
          }}
        >
          <label className="sr-only" htmlFor="palette-q">
            Search
          </label>
          <input
            id="palette-q"
            autoFocus
            className="w-full px-4 h-12 bg-transparent outline-none border-b border-line text-[15px]"
            placeholder="Start a timer, jump to a client, add time…"
            value={q}
            autoComplete="off"
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
            }}
          />
          <button type="submit" className="sr-only">
            Go
          </button>
        </form>
        <ul className="max-h-[50vh] overflow-auto p-2" role="listbox" aria-label="Results">
          {items.map((it, i) => (
            <li
              key={`${it.kind}-${it.label}-${i}`}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer ${i === active ? "bg-accent-soft" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(it);
              }}
              onKeyDown={() => {}}
            >
              {it.kind === "start" ? (
                <ClientBadge name={it.client} colour={it.colour} size={20} />
              ) : (
                <span className="w-5" />
              )}
              <span className="flex-1 min-w-0">
                <span className="block truncate">{it.label}</span>
                {"sub" in it && <span className="t-caption">{it.sub}</span>}
              </span>
              {it.kind === "start" && <span className="t-caption">⏵ ↵</span>}
              {it.kind === "go" && it.hint && <span className="t-caption">{it.hint}</span>}
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-muted">Nothing matches “{q}”.</li>
          )}
        </ul>
      </dialog>
    </>
  );
}
