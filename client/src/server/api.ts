import "server-only";
import { isValidTimeZone } from "@paypure/domain";
import { cookies } from "next/headers";
import { cache } from "react";

/**
 * The only way to reach the API (Tech §6.2). It runs on the Next server, talks to the API over
 * the internal network and carries the session as a Bearer token. The browser never calls it.
 */
const API_URL = process.env.API_URL ?? "http://localhost:4000";
export const SESSION_COOKIE = "pp_session";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function displayTz(): Promise<string | undefined> {
  const tz = (await cookies()).get("tz")?.value;
  return tz && isValidTimeZone(tz) ? tz : undefined;
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const jar = await cookies();
  const token = init.token === undefined ? jar.get(SESSION_COOKIE)?.value : init.token;
  const tz = await displayTz();
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tz ? { "X-Timezone": tz } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const { code, message, fields, ...extra } = json ?? {};
    throw new ApiError(res.status, code ?? "error", message ?? res.statusText, fields, extra);
  }
  return json as T;
}

export async function apiRaw(path: string): Promise<Response> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
}

export interface Me {
  member: {
    id: string;
    name: string;
    email: string;
    role: "admin" | "member";
    timeZone: string;
    timeFormat: "12h" | "24h";
    weekStart: number;
  };
  isAdmin: boolean;
  tz: string;
  workspace: { id: string; name: string; currency: string; timeZone: string; businessName: string };
}

/** Once per request (React cache). Null when signed out. */
export const getMe = cache(async (): Promise<Me | null> => {
  try {
    return await api<Me>("/v1/auth/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
});
