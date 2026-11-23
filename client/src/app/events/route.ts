import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pipes the API's internal SSE stream to the browser (06 §4.6). */
export async function GET(request: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return new Response("Unauthorized", { status: 401 });
  const ctrl = new AbortController();
  request.signal.addEventListener("abort", () => ctrl.abort());
  const lastId = request.headers.get("last-event-id");
  const upstream = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}/v1/events`, {
    headers: { Authorization: `Bearer ${token}`, ...(lastId ? { "Last-Event-ID": lastId } : {}) },
    signal: ctrl.signal,
    cache: "no-store",
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body)
    return new Response("Unauthorized", { status: upstream?.status ?? 502 });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
