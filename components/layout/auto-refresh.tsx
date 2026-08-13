"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatDateInput } from "@/lib/utils";
import {
  MOSCOW_DAY_CHANGED_EVENT,
  type MoscowDayChangedDetail,
} from "@/lib/time/moscow-day";

const DEFAULT_INTERVAL_MS = 60_000;
const STALE_AFTER_MS = 5 * 60_000;

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
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const checkDay = () => {
      const currentDay = formatDateInput();
      if (currentDay !== moscowDayRef.current) {
        const detail: MoscowDayChangedDetail = {
          previousDay: moscowDayRef.current,
          currentDay,
        };
        moscowDayRef.current = currentDay;
        window.dispatchEvent(new CustomEvent(MOSCOW_DAY_CHANGED_EVENT, { detail }));
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        hiddenAtRef.current = Date.now();
        return;
      }
      checkDay();
      const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;
      if (hiddenFor < STALE_AFTER_MS || isUserEditing()) return;
      startTransition(() => router.refresh());
    };

    const intervalId = window.setInterval(checkDay, intervalMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs, router]);

  return null;
}
