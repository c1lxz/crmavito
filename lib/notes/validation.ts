import { z } from "zod";

export const notePayloadSchema = z.object({
  title: z.string().trim().min(2, "Добавьте название").max(160),
  content: z.string().trim().min(1, "Напишите текст заметки").max(50_000),
  visibility: z.enum(["ALL", "SELECTED"]),
  viewerUserIds: z.array(z.string().uuid()).max(100),
  mentionUserIds: z.array(z.string().uuid()).max(100),
  productIds: z.array(z.string().uuid()).max(30),
  keepAttachmentIds: z.array(z.string().uuid()).max(30).optional(),
}).superRefine((value, context) => {
  if (
    value.visibility === "SELECTED" &&
    value.viewerUserIds.length === 0 &&
    value.mentionUserIds.length === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["viewerUserIds"],
      message: "Выберите хотя бы одного сотрудника",
    });
  }
});

export function parseNoteFormData(formData: FormData) {
  const raw = formData.get("payload");
  if (typeof raw !== "string") throw new Error("Не переданы данные заметки");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Некорректные данные заметки");
  }
  const parsed = notePayloadSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Проверьте данные заметки");
  }
  return parsed.data;
}
