"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CopyButton } from "./public-ready";
import { useFormState } from "./toaster";

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const items = [
    { href: "/settings/profile", label: "Profile" },
    ...(isAdmin
      ? [
          { href: "/settings/business", label: "Business" },
          { href: "/settings/invoicing", label: "Invoicing" },
          { href: "/settings/members", label: "Members" },
        ]
      : []),
  ];
  return (
    <nav aria-label="Settings" className="flex md:flex-col gap-1 overflow-x-auto">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={path.startsWith(i.href) ? "page" : undefined}
          className={`px-3 h-9 inline-flex items-center rounded-md font-medium whitespace-nowrap ${path.startsWith(i.href) ? "bg-accent-soft text-ink" : "text-muted hover:text-ink hover:bg-sunken"}`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Shows the invite link returned by the inviteMember action (inside its ActionForm). */
export function InviteResult() {
  const s = useFormState();
  const url = (s?.data as { inviteUrl?: string } | undefined)?.inviteUrl;
  if (!s?.ok || !url) return null;
  return (
    <div className="banner mt-3 text-sm flex-wrap">
      <span className="font-medium">One-time invite link:</span>
      <code className="break-all flex-1 min-w-0">{url}</code>
      <CopyButton value={url} label="invite link" />
    </div>
  );
}
