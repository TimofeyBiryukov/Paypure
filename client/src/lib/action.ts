import { unstable_rethrow } from "next/navigation";
import { ApiError } from "@/server/api";

export interface Toast {
  text: string;
  /** an undo performed by posting a hidden form to this server action key */
  undo?: { action: string; payload: Record<string, string> };
  link?: { href: string; label: string };
  tone?: "neutral" | "danger";
}

export type ActionState = {
  ok?: boolean;
  error?: string;
  code?: string;
  fields?: Record<string, string>;
  toast?: Toast;
  data?: Record<string, unknown>;
  at?: number;
} | null;

/** Run an API call from a Server Action and turn errors into form state (Guide §7.3). */
export async function run(fn: () => Promise<ActionState | undefined | void>): Promise<ActionState> {
  try {
    const r = await fn();
    return { ok: true, at: Date.now(), ...(r ?? {}) };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) {
      return {
        ok: false,
        error: e.message,
        code: e.code,
        fields: e.fields,
        data: e.extra,
        at: Date.now(),
      };
    }
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again.", at: Date.now() };
  }
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const optStr = (fd: FormData, k: string) => (fd.has(k) ? str(fd, k) : undefined);
export const bool = (fd: FormData, k: string) =>
  fd.get(k) === "on" || fd.get(k) === "true" || fd.get(k) === "1";
