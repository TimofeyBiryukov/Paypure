import { todayIn } from "@paypure/domain";
import { redirect } from "next/navigation";
import { Builder, type BuilderData } from "@/components/builder";
import { ClientBadge, PageHeader } from "@/components/ui";
import { api, getMe } from "@/server/api";

export const metadata = { title: "New invoice" };

/** Invoice builder (S9): turn unbilled work into a correct draft in under a minute. */
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; project?: string }>;
}) {
  const me = (await getMe())!;
  if (!me.isAdmin) redirect("/");
  const sp = await searchParams;
  if (!sp.client) redirect("/invoices");
  const qs = new URLSearchParams({ client: sp.client });
  if (sp.project) qs.set("project", sp.project);
  const data = await api<BuilderData>(`/v1/invoices/builder?${qs}`);
  return (
    <div>
      <PageHeader
        crumbs={[{ href: "/invoices", label: "Invoices" }]}
        title={
          <span className="flex items-center gap-3">
            <ClientBadge name={data.client.name} colour={data.client.colour} size={32} /> New
            invoice for {data.client.name}
          </span>
        }
      />
      <Builder data={data} today={todayIn(me.workspace.timeZone)} />
    </div>
  );
}
