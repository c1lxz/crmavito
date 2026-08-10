import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const employeeRoutes = [
  "app/api/ai/content-machine/codex-jobs/route.ts",
  "app/api/ai/content-machine/codex-jobs/auto/route.ts",
  "app/api/ai/content-machine/codex-jobs/[id]/route.ts",
  "app/api/ai/content-machine/codex-jobs/[id]/retry/route.ts",
  "app/api/ai/content-machine/codex-jobs/[id]/files/[kind]/[fileName]/route.ts",
  "app/api/ai/content-machine/flow-agent/status/route.ts",
];

describe("Content Machine employee access", () => {
  it("allows any authenticated employee to open and operate Flow jobs", async () => {
    const page = await readFile(path.join(root, "app/(app)/content-machine/page.tsx"), "utf8");
    expect(page).not.toContain('role !== "ADMIN"');
    expect(page).toContain("canManageBackgrounds");
    for (const route of employeeRoutes) {
      const source = await readFile(path.join(root, route), "utf8");
      expect(source, route).toContain("if (!session?.user)");
      expect(source, route).not.toContain('role !== "ADMIN"');
    }
  });

  it("keeps shared background changes admin-only", async () => {
    const backgrounds = await readFile(path.join(root, "app/api/ai/content-machine/backgrounds/route.ts"), "utf8");
    expect(backgrounds).toContain('session.user.role !== "ADMIN"');
  });
});
