import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTaskSchema, readTaskRequest } from "@/lib/tasks/request";
import {
  MAX_TASK_FILE_SIZE,
  removeTaskFiles,
  validateTaskFiles,
} from "@/lib/tasks/storage";

const payload = {
  title: "Проверить документы",
  description: "Сверить накладную",
  assigneeUserIds: ["11111111-1111-4111-8111-111111111111"],
  dueAt: "2026-07-25T12:00:00.000Z",
  scheduledAt: null,
};

describe("task attachments", () => {
  it("reads a regular task from JSON without multipart parsing", async () => {
    const result = await readTaskRequest(
      new Request("https://crmavito.example/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      createTaskSchema,
    );

    expect(result.payload.title).toBe("Проверить документы");
    expect(result.files).toEqual([]);
  });

  it("reads task fields and multiple files from multipart form data", async () => {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(payload));
    formData.append("files", new File(["one"], "photo.jpg", { type: "image/jpeg" }));
    formData.append("files", new File(["two"], "invoice.pdf", { type: "application/pdf" }));

    const result = await readTaskRequest(
      new Request("https://crmavito.example/api/tasks", {
        method: "POST",
        body: formData,
      }),
      createTaskSchema,
    );

    try {
      expect(result.payload.title).toBe("Проверить документы");
      expect(result.files.map((file) => file.name)).toEqual([
        "photo.jpg",
        "invoice.pdf",
      ]);
    } finally {
      await removeTaskFiles(result.files.map((file) => file.storageKey));
    }
  });

  it("rejects unsupported and oversized files", () => {
    expect(() =>
      validateTaskFiles([
        new File(["script"], "script.exe", {
          type: "application/x-msdownload",
        }),
      ]),
    ).toThrow("Разрешены изображения");

    const oversized = new File(["x"], "large.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(oversized, "size", {
      value: MAX_TASK_FILE_SIZE + 1,
    });
    expect(() => validateTaskFiles([oversized])).toThrow("до 300 МБ");
  });

  it("serves attachments only to authenticated CRM users", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "app/api/tasks/files/[id]/route.ts"),
      "utf8",
    );
    expect(source).toContain("const session = await auth()");
    expect(source).toContain('error: "Unauthorized"');
    expect(source).toContain('"X-Content-Type-Options": "nosniff"');
    expect(source).toContain("filename*=UTF-8");
  });

  it("keeps file controls usable in the task editor and task list", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "components/tasks/tasks-client.tsx"),
      "utf8",
    );
    expect(source).toContain("Прикрепить файлы");
    expect(source).toContain("form.keepAttachmentIds");
    expect(source).toContain("<TaskAttachments attachments={task.attachments} />");
    expect(source).toContain("max-h-[90dvh]");
  });
});
