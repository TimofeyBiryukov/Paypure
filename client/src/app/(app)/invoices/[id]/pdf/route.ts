import { apiRaw } from "@/server/api";

/** Signed-in PDF download: the stored bytes of a frozen version, or a watermarked draft. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const version = new URL(request.url).searchParams.get("version");
  const res = await apiRaw(
    `/v1/invoices/${id}/pdf${version ? `?version=${encodeURIComponent(version)}` : ""}`,
  );
  if (!res.ok) return new Response(await res.text(), { status: res.status });
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": res.headers.get("content-disposition") ?? "inline",
    },
  });
}
