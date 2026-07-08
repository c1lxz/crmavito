import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const clientSource = readFileSync(path.resolve(__dirname, "../components/botv/botv-mini-app.tsx"), "utf8");
const pageSource = readFileSync(path.resolve(__dirname, "../app/v/page.tsx"), "utf8");
const apiSource = readFileSync(path.resolve(__dirname, "../app/api/botv/session/route.ts"), "utf8");

describe("botv mini app UI", () => {
  it("mounts on /v and uploads archives through botv API", () => {
    expect(pageSource).toContain("BotvMiniApp");
    expect(clientSource).toContain("/api/botv/session");
    expect(clientSource).toContain("Ссылка на Яндекс.Диск");
    expect(apiSource).toContain("createSessionFromFile");
    expect(apiSource).toContain("createSessionFromLink");
  });

  it("supports the requested listing workflow", () => {
    expect(clientSource).toContain("Название из папки");
    expect(clientSource).toContain("Одна цена");
    expect(clientSource).toContain("deleteSelected");
    expect(clientSource).toContain("Как на Avito");
    expect(clientSource).toContain("firstPhoto");
    expect(clientSource).toContain("lg:grid-cols-[minmax(0,1fr)_420px]");
    expect(clientSource).toContain("xl:grid-cols-2");
    expect(clientSource).toContain("lg:sticky lg:top-28");
  });
});
