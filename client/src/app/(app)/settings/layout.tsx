import { SettingsNav } from "@/components/settings-client";
import { getMe } from "@/server/api";

/** Settings (S16): same shell, left sub-nav inside the content; a list on mobile. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const me = (await getMe())!;
  return (
    <div>
      <h1 className="t-title-1 mb-6">Settings</h1>
      <div className="grid md:grid-cols-[180px_1fr] gap-6 md:gap-10">
        <SettingsNav isAdmin={me.isAdmin} />
        <div className="min-w-0 max-w-[720px]">{children}</div>
      </div>
    </div>
  );
}
