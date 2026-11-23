import type { SheetData } from "@paypure/domain";
import { notFound } from "next/navigation";
import { InvoiceSheet } from "@/components/sheet";
import { api } from "@/server/api";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const printCss = `
@page { size: A4; margin: 10mm 10mm 14mm; }
html, body { background: #fff !important; color-scheme: light; }
.invoice-sheet { box-shadow: none !important; border-radius: 0 !important; width: 100% !important; padding: 0 !important; }
.sheet-line, .sheet-keep { break-inside: avoid; page-break-inside: avoid; }
thead { display: table-header-group; }
`;

/** Gotenberg waits for window.__sheetReady (Tech §5.5): set once fonts are loaded. */
const readyScript = `(function(){var d=function(){window.__sheetReady=true};try{(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(d)}catch(e){d()}setTimeout(d,3000)})();`;

/**
 * The print route Gotenberg loads (Tech §5.5). Reachable only with a valid short-lived signature,
 * which the API verifies; Traefik also keeps /print off the public router in prod.
 */
export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ exp?: string; wm?: string; sig?: string }>;
}) {
  const { id } = await params;
  const { exp = "", wm = "0", sig = "" } = await searchParams;
  let sheet: SheetData;
  try {
    sheet = await api<SheetData>(
      `/v1/print/versions/${encodeURIComponent(id)}?exp=${encodeURIComponent(exp)}&wm=${encodeURIComponent(wm)}&sig=${encodeURIComponent(sig)}`,
      { token: null },
    );
  } catch {
    notFound();
  }
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static print CSS */}
      <style dangerouslySetInnerHTML={{ __html: printCss }} />
      <InvoiceSheet s={sheet} />
      {/* Plain inline script, so readiness doesn't depend on hydration. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: readiness flag for Gotenberg */}
      <script dangerouslySetInnerHTML={{ __html: readyScript }} />
    </>
  );
}
