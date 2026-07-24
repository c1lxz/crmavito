"use client";

import { useEffect } from "react";
import Script from "next/script";
import { useTheme } from "next-themes";

interface TgWebApp {
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

function applyInsets() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    document.documentElement.style.setProperty("--app-top-pad", "48px");
    return;
  }
  const top = (tg.safeAreaInset?.top ?? 0) + (tg.contentSafeAreaInset?.top ?? 0);
  const bottom = tg.safeAreaInset?.bottom ?? 0;
  document.documentElement.style.setProperty("--app-top-pad", `${Math.max(top + 8, 16)}px`);
  document.documentElement.style.setProperty("--app-bottom-pad", `${bottom}px`);
}

export function TelegramInit() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const init = () => {
      const tg = window.Telegram?.WebApp;
      if (!tg) {
        document.documentElement.style.setProperty("--app-top-pad", "48px");
        return;
      }
      tg.ready?.();
      tg.expand?.();
      tg.disableVerticalSwipes?.();
      applyInsets();
      tg.onEvent?.("safeAreaChanged", applyInsets);
      tg.onEvent?.("contentSafeAreaChanged", applyInsets);
      tg.onEvent?.("viewportChanged", applyInsets);
    };

    if (window.Telegram?.WebApp) {
      init();
    } else {
      const timer = setTimeout(init, 100);
      return () => clearTimeout(timer);
    }

    return () => {
      const tg = window.Telegram?.WebApp;
      tg?.offEvent?.("safeAreaChanged", applyInsets);
      tg?.offEvent?.("contentSafeAreaChanged", applyInsets);
      tg?.offEvent?.("viewportChanged", applyInsets);
    };
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    const isDark = resolvedTheme === "dark";
    tg.setHeaderColor?.(isDark ? "#172033" : "#eef2f7");
    tg.setBackgroundColor?.(isDark ? "#101623" : "#eef2f7");
  }, [resolvedTheme]);

  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="beforeInteractive"
    />
  );
}
