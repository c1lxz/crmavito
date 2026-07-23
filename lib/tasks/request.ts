import { z } from "zod";

export const createTaskSchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().optional(),
  assigneeUserIds: z.array(z.string().uuid()).min(1),
  dueAt: z.string().datetime(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().nullable().optional(),
  assigneeUserIds: z.array(z.string().uuid()).min(1).optional(),
  dueAt: z.string().datetime().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  status: z.enum(["OPEN", "COMPLETED"]).optional(),
  keepAttachmentIds: z.array(z.string().uuid()).max(6).optional(),
});

export async function readTaskRequest<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ payload: z.infer<T>; files: File[] }> {
  const contentType = request.headers.get("content-type") ?? "";
  let raw: unknown;
  let files: File[] = [];

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const payload = formData.get("payload");
    if (typeof payload !== "string") {
      throw new Error("Не переданы данные задачи");
    }
    try {
      raw = JSON.parse(payload);
    } catch {
      throw new Error("Некорректные данные задачи");
    }
    files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File && value.size > 0);
  } else {
    raw = await request.json();
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Проверьте данные задачи");
  }

  return { payload: parsed.data, files };
}
