"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatDateInput } from "@/lib/utils";
import {
  MOSCOW_DAY_CHANGED_EVENT,
  type MoscowDayChangedDetail,
} from "@/lib/time/moscow-day";

const DEFAULT_INTERVAL_MS = 60_000;

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
  const moscowDayRef = useRef(formatDateInput());

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const currentDay = formatDateInput();
      let dayChanged = false;
      if (currentDay !== moscowDayRef.current) {
        dayChanged = true;
        const detail: MoscowDayChangedDetail = {
          previousDay: moscowDayRef.current,
          currentDay,
        };
        moscowDayRef.current = currentDay;
        window.dispatchEvent(new CustomEvent(MOSCOW_DAY_CHANGED_EVENT, { detail }));
      }
      if (!dayChanged && isUserEditing()) return;
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
