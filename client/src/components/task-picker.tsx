"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CatalogTask } from "@/lib/types";
import { ClientBadge } from "./ui";

/**
 * Task picker (Guide §5.3): matches tokens across client, project and task, groups under
 * "Client / Project", recent tasks first. While the listbox is open, Enter selects the option
 * (the only place we preventDefault on Enter, Guide §7.2 rule 6). Submits through a hidden input.
 */
export function TaskPicker({
  tasks,
  recent = [],
  name = "taskId",
  defaultTaskId,
  autoFocus,
  submitOnPick,
  required,
  placeholder = "Search tasks…",
  onPick,
  label = "Task",
  hideLabel,
}: {
  tasks: CatalogTask[];
  recent?: string[];
  name?: string;
  defaultTaskId?: string | null;
  autoFocus?: boolean;
  submitOnPick?: boolean;
  required?: boolean;
  placeholder?: string;
  onPick?: (t: CatalogTask) => void;
  label?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState<string>(defaultTaskId ?? "");
  const selected = tasks.find((t) => t.id === value);
  const [query, setQuery] = useState(selected ? `${selected.clientName} / ${selected.projectName} › ${selected.name}` : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const tokens = query.toLowerCase().split(/[\s/›]+/).filter(Boolean);
    const showAll = !!selected && query.startsWith(selected.clientName);
    const list = tasks.filter((t) => {
      if (showAll || tokens.length === 0) return true;
      const hay = `${t.clientName} ${t.projectName} ${t.name}`.toLowerCase();
      return tokens.every((tok) => hay.includes(tok));
    });
    const rank = (t: CatalogTask) => {
      const r = recent.indexOf(t.id);
      return r === -1 ? 100 : r;
    };
    return list.sort((a, b) => rank(a) - rank(b)).slice(0, 50);
  }, [query, tasks, recent, selected]);

  useEffect(() => setActive(0), []);

  const pick = (t: CatalogTask) => {
    setValue(t.id);
    setQuery(`${t.clientName} / ${t.projectName} › ${t.name}`);
    setOpen(false);
    onPick?.(t);
    if (submitOnPick) {
      // Let React flush the hidden input's value, then submit through the normal path.
      setTimeout(() => hiddenRef.current?.form?.requestSubmit(), 0);
    }
  };

  const tokens = query.toLowerCase().split(/[\s/›]+/).filter(Boolean);
  const hl = (s: string) => {
    if (!tokens.length) return s;
    const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
    return s.split(re).map((part, i) =>
      // biome-ignore lint/suspicious/noArrayIndexKey: text fragments
      re.test(part) ? <b key={i}>{part}</b> : <span key={i}>{part}</span>,
    );
  };

  return (
    <div className="relative">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "label"}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${id}-opt-${results[active].id}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setValue("");
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && results[active] && !value) {
            // Combobox open: Enter selects the highlighted option instead of submitting.
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      <input
        ref={hiddenRef}
        type="text"
        name={name}
        value={value}
        required={required}
        onChange={() => {}}
        tabIndex={-1}
        aria-hidden
        className="absolute opacity-0 pointer-events-none h-0 w-0 bottom-0 left-4"
        onInvalid={(e) => (e.target as HTMLInputElement).setCustomValidity(value ? "" : "Choose a task")}
      />
      {open && results.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="pop absolute z-50 mt-1 w-full max-h-72 overflow-auto p-1">
          {results.map((t, i) => {
            const groupStart = i === 0 || results[i - 1].projectId !== t.projectId;
            return (
              <li key={t.id} role="presentation">
                {groupStart && (
                  <div className="flex items-center gap-2 px-2 pt-2 pb-1 t-caption">
                    <ClientBadge name={t.clientName} colour={t.colour} size={16} />
                    {hl(t.clientName)} / {hl(t.projectName)}
                  </div>
                )}
                <div
                  id={`${id}-opt-${t.id}`}
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  className={`px-3 py-1.5 rounded-md cursor-pointer ${i === active ? "bg-accent-soft" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(t);
                  }}
                  onMouseEnter={() => setActive(i)}
                  onKeyDown={() => {}}
                >
                  {hl(t.name)}
                  {t.billingMode !== "hourly" && (
                    <span className="t-caption ml-2">{t.billingMode === "fixed" ? "Fixed fee" : "Non-billable"}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {open && results.length === 0 && (
        <div className="pop absolute z-50 mt-1 w-full p-3 text-muted">No task matches “{query}”. Admins add tasks on the project page.</div>
      )}
    </div>
  );
}
