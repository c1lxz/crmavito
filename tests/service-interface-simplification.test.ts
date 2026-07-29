import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const botvSource = readFileSync(path.join(root, "components/botv/botv-mini-app.tsx"), "utf8");
const wbResaleSource = readFileSync(path.join(root, "components/wbr/wb-resale-client.tsx"), "utf8");
const contentMachineSource = readFileSync(path.join(root, "components/content-machine/content-machine-client.tsx"), "utf8");

describe("service interfaces use progressive disclosure", () => {
  it("keeps secondary XML controls out of the default product card", () => {
    expect(botvSource).toContain("Загрузить по ссылке");
    expect(botvSource).toContain("Описание и фотографии");
    expect(botvSource).toContain('aria-label="Сделать фото первым"');
  });

  it("groups rare WB Resale fields and listing actions", () => {
    expect(wbResaleSource).toContain("Дополнительные параметры");
    expect(wbResaleSource).toContain("Другие действия WB Resale");
    expect(wbResaleSource).toContain("Действия с ${item.title}");
    expect(wbResaleSource).toContain("wb-resale-actions mt-2");
  });

  it("collapses content generation settings without removing them", () => {
    expect(contentMachineSource).toContain("Параметры генерации");
    expect(contentMachineSource).toContain('id="content-mode"');
    expect(contentMachineSource).toContain('id="design-note"');
  });
});
