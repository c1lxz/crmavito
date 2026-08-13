import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) =>
  readFileSync(path.resolve(__dirname, `../${file}`), "utf8");

describe("mobile interaction stability", () => {
  it("anchors dialogs while the software keyboard changes viewport height", () => {
    const dialog = source("components/ui/dialog.tsx");
    const globals = source("app/globals.css");

    expect(dialog).toContain("dialog-content fixed");
    expect(globals).toContain("(hover: none) and (pointer: coarse)");
    expect(globals).toContain("top: calc(var(--app-top-pad, 48px) + 0.5rem)");
    expect(globals).toContain("--tw-translate-y: 0");
  });

  it("keeps the order header and submit action fixed around one scroll area", () => {
    const orderDialog = source("components/orders/create-order-dialog.tsx");

    expect(orderDialog).toContain('DialogHeader className="shrink-0');
    expect(orderDialog).toContain('className="flex min-h-0 flex-1 flex-col"');
    expect(orderDialog).toContain("min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain");
    expect(orderDialog).toContain('className="shrink-0 border-t');
    expect(orderDialog).toContain("h-[calc(100dvh-var(--app-top-pad,48px)");
  });

  it("lets portal selects grow to their options instead of one trigger-height row", () => {
    const select = source("components/ui/select.tsx");

    expect(select).not.toContain("h-[var(--radix-select-trigger-height)]");
    expect(select).toContain("min-w-[var(--radix-select-trigger-width)]");
  });

  it("uses iOS-safe input sizing without disabling page zoom", () => {
    const input = source("components/ui/input.tsx");
    const textarea = source("components/ui/textarea.tsx");
    const select = source("components/ui/select.tsx");
    const layout = source("app/layout.tsx");

    expect(input).toContain("h-11");
    expect(input).toContain("text-base");
    expect(textarea).toContain("text-base");
    expect(select).toContain("h-11");
    expect(select).toContain("min-h-11");
    expect(layout).toContain('interactiveWidget: "resizes-content"');
    expect(layout).not.toContain("userScalable: false");
    expect(layout).not.toContain("maximumScale: 1");
  });
});
