import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_NOTE_FILE_SIZE, validateNoteFiles } from "@/lib/notes/storage";
import { parseNoteFormData } from "@/lib/notes/validation";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Важная заметка",
    content: "Проверить условия и ссылку на объявление",
    visibility: "ALL",
    viewerUserIds: [],
    productIds: [],
    ...overrides,
  };
}

describe("notebook notes", () => {
  it("accepts a concise public note", () => {
    const form = new FormData();
    form.set("payload", JSON.stringify(payload()));
    expect(parseNoteFormData(form)).toMatchObject({
      title: "Важная заметка",
      visibility: "ALL",
    });
  });

  it("requires at least one viewer for a private note", () => {
    const form = new FormData();
    form.set("payload", JSON.stringify(payload({ visibility: "SELECTED" })));
    expect(() => parseNoteFormData(form)).toThrow("Выберите хотя бы одного сотрудника");
  });

  it("rejects unsupported or oversized attachments", () => {
    expect(() => validateNoteFiles([
      new File(["script"], "script.exe", { type: "application/x-msdownload" }),
    ])).toThrow("Разрешены изображения");

    const oversized = new File(["x"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", { value: MAX_NOTE_FILE_SIZE + 1 });
    expect(() => validateNoteFiles([oversized])).toThrow("до 15 МБ");
  });

  it("checks note visibility before serving an attachment", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "app/api/notes/files/[id]/route.ts"),
      "utf8",
    );
    expect(source).toContain('{ visibility: "ALL" }');
    expect(source).toContain('{ createdByUserId: session.user.id }');
    expect(source).toContain('{ viewers: { some: { userId: session.user.id } } }');
    expect(source).toContain('"X-Content-Type-Options": "nosniff"');
  });

  it("exposes both notes and tasks from the renamed notebook", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "components/notebook/notebook-client.tsx"),
      "utf8",
    );
    expect(source).toContain("Блокнот");
    expect(source).toContain("Написать заметку");
    expect(source).toContain("Поставить задачу");
    expect(source).toContain("Добавить товары");
  });
});
