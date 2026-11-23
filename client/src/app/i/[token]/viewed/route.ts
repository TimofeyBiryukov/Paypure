export const dynamic = "force-dynamic";

/** Beacon target for "Viewed" (08 §10); forwards to the API. */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await fetch(`${process.env.API_URL ?? "http://localhost:4000"}/v1/public/invoices/${encodeURIComponent(token)}/viewed`, {
    method: "POST",
    cache: "no-store",
  }).catch(() => null);
  return new Response(null, { status: 204 });
}
