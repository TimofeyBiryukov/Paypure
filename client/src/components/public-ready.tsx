"use client";

import { useEffect } from "react";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
      Print
    </button>
  );
}

/** "Viewed" is logged by a beacon after 2 s of visibility, never by the GET (08 §10). */
export function ViewedBeacon({ token }: { token: string }) {
  useEffect(() => {
    let sent = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible" || sent) return;
      timer = setTimeout(() => {
        if (document.visibilityState === "visible" && !sent) {
          sent = true;
          navigator.sendBeacon(`/i/${token}/viewed`);
        }
      }, 2000);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [token]);
  return null;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      aria-label={`Copy ${label}`}
      onClick={async (e) => {
        const b = e.currentTarget;
        try {
          await navigator.clipboard.writeText(value);
          b.textContent = "Copied";
          setTimeout(() => {
            b.textContent = "Copy";
          }, 1500);
        } catch {}
      }}
    >
      Copy
    </button>
  );
}
