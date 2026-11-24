import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { LiveSync } from "@/components/live-sync";
import { NavLinks } from "@/components/nav";
import { Palette } from "@/components/palette";
import { TimerPill } from "@/components/timer";
import { ToastProvider } from "@/components/toaster";
import type { Catalog, TimerSnapshot } from "@/lib/types";
import { api, getMe } from "@/server/api";

/** App shell (Guide §4.1): one slim top bar, the timer pill on every page, ⌘K, avatar menu. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");
  const [catalog, timer] = await Promise.all([
    api<Catalog>("/v1/catalog"),
    api<{ entries: TimerSnapshot[] }>("/v1/timer"),
  ]);
  const initials = me.member.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <ToastProvider>
      <LiveSync />
      <header className="sticky top-0 z-30 bg-surface border-b border-line">
        <div className="mx-auto max-w-[1264px] h-14 px-4 sm:px-6 lg:px-8 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-[15px] shrink-0">
            <span className="inline-block w-3 h-3 rotate-45 rounded-[2px]" style={{ background: "var(--accent)" }} aria-hidden />
            paypure
          </Link>
          <NavLinks isAdmin={me.isAdmin} variant="top" />
          <div className="ml-auto flex items-center gap-1">
            <TimerPill initial={timer.entries} catalog={catalog} tz={me.tz} timeFormat={me.member.timeFormat} />
            <Palette catalog={catalog} isAdmin={me.isAdmin} />
            <details className="menu relative">
              <summary className="w-8 h-8 rounded-full bg-sunken flex items-center justify-center t-micro focus-ring" aria-label="Account menu">
                {initials}
              </summary>
              <div className="menu-body pop right-0 mt-2">
                <div className="px-3 py-2 border-b border-line mb-1">
                  <div className="font-medium">{me.member.name}</div>
                  <div className="t-caption">{me.workspace.name} · {me.isAdmin ? "Admin" : "Member"}</div>
                </div>
                <Link href="/settings/profile" className="menu-item">
                  Profile
                </Link>
                {me.isAdmin && (
                  <Link href="/settings/business" className="menu-item">
                    Settings
                  </Link>
                )}
                <form action={logout}>
                  <button type="submit" className="menu-item">
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1264px] px-4 sm:px-6 lg:px-8 pt-6 pb-24 sm:pb-12">{children}</main>
      <NavLinks isAdmin={me.isAdmin} variant="bottom" />
    </ToastProvider>
  );
}
