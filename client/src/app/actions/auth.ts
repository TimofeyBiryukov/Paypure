"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type ActionState, run, str } from "@/lib/action";
import { api, SESSION_COOKIE } from "@/server/api";

async function setSession(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
}

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  const r = await run(async () => {
    const { token } = await api<{ token: string }>("/v1/auth/login", {
      body: { email: str(fd, "email"), password: String(fd.get("password") ?? ""), tz: str(fd, "tz") || undefined },
      token: null,
    });
    await setSession(token);
    ok = true;
  });
  if (ok) redirect(str(fd, "next").startsWith("/") ? str(fd, "next") : "/");
  return r;
}

export async function acceptInvite(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  const r = await run(async () => {
    const { token } = await api<{ token: string }>("/v1/auth/accept-invite", {
      body: { token: str(fd, "token"), password: String(fd.get("password") ?? ""), tz: str(fd, "tz") || undefined },
      token: null,
    });
    await setSession(token);
    ok = true;
  });
  if (ok) redirect("/");
  return r;
}

export async function logout() {
  try {
    await api("/v1/auth/logout", { body: {} });
  } catch {}
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
