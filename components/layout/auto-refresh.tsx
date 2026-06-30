"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_INTERVAL_MS = 15_000;

function isUserEditing(): boolean {
  const active = document.activeElement;
  const activeInput =
    active instanceof HTMLElement &&
    active.matches("input, textarea, select, [contenteditable='true']");
  const openDialog = document.querySelector('[role="dialog"][data-state="open"]');

  return activeInput || Boolean(openDialog);
}

export function AutoRefresh({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || isUserEditing()) return;
      startTransition(() => router.refresh());
    };

    const intervalId = window.setInterval(refresh, intervalMs);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [intervalMs, router]);

  return null;
}
