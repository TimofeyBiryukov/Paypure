"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/** A modal <dialog> opened by a URL param (URL is state, Guide §6); closing removes the param. */
export function UrlDialog({ param, title, children, variant = "dialog" }: { param: string; title: string; children: React.ReactNode; variant?: "dialog" | "panel" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  const close = () => {
    const p = new URLSearchParams(params.toString());
    p.delete(param);
    router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  return (
    <dialog ref={ref} className={variant} onClose={close} aria-labelledby={`${param}-title`}>
      <div className="flex items-center justify-between px-5 h-14 border-b border-line">
        <h2 id={`${param}-title`} className="t-title-3">
          {title}
        </h2>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={() => ref.current?.close()}>
          <X size={16} />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

export function CloseButton({ children = "Cancel" }: { children?: React.ReactNode }) {
  return (
    <button type="button" className="btn btn-secondary" onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
      {children}
    </button>
  );
}
