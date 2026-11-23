"use client";

import { Clock, FileText, Home, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Home · Time · Clients · Invoices. Members don't see Invoices (S3 sitemap). */
export function NavLinks({ isAdmin, variant }: { isAdmin: boolean; variant: "top" | "bottom" }) {
  const path = usePathname();
  const items = [
    { href: "/", label: "Home", icon: Home },
    { href: "/time", label: "Time", icon: Clock },
    { href: "/clients", label: "Clients", icon: Users },
    ...(isAdmin ? [{ href: "/invoices", label: "Invoices", icon: FileText }] : []),
  ];
  const current = (href: string) => (href === "/" ? path === "/" : path.startsWith(href) || (href === "/clients" && path.startsWith("/projects")));
  if (variant === "top") {
    return (
      <nav className="hidden sm:flex items-center gap-1" aria-label="Main">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={current(i.href) ? "page" : undefined}
            className={`px-3 h-8 inline-flex items-center rounded-md font-medium ${current(i.href) ? "bg-accent-soft text-ink" : "text-muted hover:text-ink hover:bg-sunken"}`}
          >
            {i.label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }} aria-label="Main">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={current(i.href) ? "page" : undefined} className={`flex flex-col items-center justify-center h-14 gap-0.5 text-[11px] font-medium ${current(i.href) ? "text-accent" : "text-muted"}`}>
          <i.icon size={18} aria-hidden />
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
