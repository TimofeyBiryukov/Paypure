"use client";

import Link from "next/link";
import {
  createContext,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import * as undoActions from "@/app/actions/undo";
import type { ActionState, Toast } from "@/lib/action";
import { Submit } from "./submit";

type ToastItem = Toast & { id: number };
const ToastCtx = createContext<(t: Toast) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

/** Bottom-centre toasts, 5 s, with Undo where possible (Guide §5.14). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Toast) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.undo ? 8000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="pop flex items-center gap-3 px-4 py-2.5 text-sm"
            style={t.tone === "danger" ? { color: "var(--danger-fg)" } : undefined}
          >
            <span>{t.text}</span>
            {t.link && (
              <Link href={t.link.href} className="font-medium text-accent">
                {t.link.label}
              </Link>
            )}
            {t.undo && (
              <UndoForm
                undo={t.undo}
                onDone={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
              />
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function UndoForm({ undo, onDone }: { undo: NonNullable<Toast["undo"]>; onDone: () => void }) {
  const action = undoActions[undo.action as keyof typeof undoActions];
  const push = useToast();
  const [state, formAction] = useActionState(action, null);
  useEffect(() => {
    if (state?.ok) onDone();
    if (state && !state.ok && state.error) push({ text: state.error, tone: "danger" });
  }, [state, onDone, push]);
  return (
    <form action={formAction}>
      {Object.entries(undo.payload).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Submit className="btn btn-ghost btn-sm text-accent">Undo</Submit>
    </form>
  );
}

const FormStateCtx = createContext<ActionState>(null);
export const useFormState = () => useContext(FormStateCtx);

/**
 * A real <form> bound to a Server Action (Guide §7). Errors flow to <FieldError>, toasts to the
 * toaster. Optionally closes its <dialog> or resets on success.
 */
export function ActionForm({
  action,
  children,
  className,
  id,
  reset,
  closeDialog,
  role,
  onSuccess,
  showError = true,
  autoComplete,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  id?: string;
  reset?: boolean;
  closeDialog?: boolean;
  role?: string;
  onSuccess?: (s: ActionState) => void;
  showError?: boolean;
  autoComplete?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const push = useToast();
  const ref = useRef<HTMLFormElement>(null);
  const seen = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state || state.at === seen.current) return;
    seen.current = state.at;
    if (state.ok) {
      if (state.toast) push(state.toast);
      if (reset) ref.current?.reset();
      if (closeDialog) ref.current?.closest("dialog")?.close();
      onSuccess?.(state);
    } else if (state.fields && ref.current) {
      // Move focus to the first invalid field (Guide §7.3).
      const first = Object.keys(state.fields)[0];
      const el = ref.current.querySelector<HTMLElement>(`[name="${first}"]`);
      el?.focus();
    }
  }, [state, push, reset, closeDialog, onSuccess]);
  return (
    <FormStateCtx.Provider value={state}>
      <form
        ref={ref}
        action={formAction}
        className={className}
        id={id}
        role={role}
        autoComplete={autoComplete}
      >
        {showError && state && !state.ok && state.error && (
          <div className="banner banner-danger mb-3 text-sm" role="alert">
            {state.error}
          </div>
        )}
        {children}
      </form>
    </FormStateCtx.Provider>
  );
}

export function FieldError({ name }: { name: string }) {
  const s = useFormState();
  const msg = s?.fields?.[name];
  return msg ? (
    <p className="error-text" id={`${name}-error`}>
      {msg}
    </p>
  ) : null;
}
