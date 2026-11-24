"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Live sync in the browser (06 §4.4): one EventSource per browser (leader elected with Web
 * Locks), fanned out to the other tabs over BroadcastChannel. Timer events carry the snapshot;
 * everything else triggers a debounced router.refresh().
 */
export function LiveSync() {
  const router = useRouter();
  useEffect(() => {
    let es: EventSource | null = null;
    let release: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hiddenSince: number | null = null;
    const ch = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("paypure") : null;

    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };
    const apply = (ev: { topic?: string; entity?: string; timer?: unknown; type?: string }) => {
      if (ev.type === "resync") return refresh();
      if (ev.type === "session") {
        window.location.href = "/login";
        return;
      }
      if (ev.topic === "timer") {
        // Timers run in parallel: each event updates one of them, by entry id (06 §4.3).
        window.dispatchEvent(new CustomEvent("pp:timer", { detail: { id: ev.entity, timer: ev.timer ?? null } }));
        return;
      }
      if (ev.topic) refresh();
    };
    ch?.addEventListener("message", (m) => apply(m.data));

    const connect = () => {
      if (es) return;
      es = new EventSource("/events");
      es.onmessage = (m) => {
        try {
          const data = JSON.parse(m.data);
          apply(data);
          ch?.postMessage(data);
        } catch {}
      };
      es.addEventListener("resync", () => {
        apply({ type: "resync" });
        ch?.postMessage({ type: "resync" });
      });
      es.addEventListener("session", () => {
        apply({ type: "session" });
        ch?.postMessage({ type: "session" });
      });
    };
    const disconnect = () => {
      es?.close();
      es = null;
    };

    const becomeLeader = () => {
      if (navigator.locks?.request) {
        navigator.locks.request("paypure-sse", () => {
          connect();
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        });
      } else {
        connect();
      }
    };
    becomeLeader();

    // Hidden for 5 minutes → close the stream; back to visible → reconnect and refresh once.
    const vis = () => {
      if (document.hidden) {
        hiddenSince = Date.now();
        setTimeout(() => {
          if (document.hidden && hiddenSince && Date.now() - hiddenSince >= 300_000) disconnect();
        }, 300_000);
      } else {
        if (!es && release) connect();
        if (hiddenSince && Date.now() - hiddenSince > 60_000) router.refresh();
        hiddenSince = null;
      }
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      disconnect();
      release?.();
      ch?.close();
      clearTimeout(timer);
    };
  }, [router]);
  return null;
}
