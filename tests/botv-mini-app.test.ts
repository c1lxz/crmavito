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
    expect(clientSource).toContain("setPhonePromptOpen(true)");
    expect(clientSource).toContain("movePhoto");
    expect(clientSource).toContain("PanelTop");
    expect(clientSource).toContain("Описание");
    expect(clientSource).toContain("fixed inset-0 z-50");
    expect(clientSource).toContain("cursor-pointer");
    expect(clientSource).not.toContain("<Eye");
  });

  it("requests duplicate XML with a replacement phone", () => {
    expect(clientSource).toContain("JSON.stringify({ phone })");
    expect(clientSource).toContain("Создать XML с другим телефоном?");
    expect(clientSource).toContain("Скачать");
  });
});
