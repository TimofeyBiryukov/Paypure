export const dynamic = "force-dynamic";

/** Public PDF download: the stored bytes of the frozen version (08 §3.2). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const version = new URL(req.url).searchParams.get("version");
  const res = await fetch(
    `${process.env.API_URL ?? "http://localhost:4000"}/v1/public/invoices/${encodeURIComponent(token)}/pdf${version ? `?version=${encodeURIComponent(version)}` : ""}`,
    { cache: "no-store" },
  ).catch(() => null);
  if (!res?.ok || !res.body) return new Response("Not found", { status: res?.status ?? 502 });
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": res.headers.get("content-disposition") ?? "inline",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
