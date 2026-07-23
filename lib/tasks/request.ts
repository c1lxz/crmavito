import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { z } from "zod";
import {
  createTaskStorageKey,
  ensureTaskStorageDirectory,
  MAX_TASK_FILES,
  MAX_TASK_FILE_SIZE,
  removeTaskFiles,
  type StoredTaskFile,
  validateTaskFileMetadata,
} from "@/lib/tasks/storage";

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
): Promise<{ payload: z.infer<T>; files: StoredTaskFile[] }> {
  const contentType = request.headers.get("content-type") ?? "";
  let raw: unknown;
  let files: StoredTaskFile[] = [];

  if (contentType.includes("multipart/form-data")) {
    const multipart = await readMultipartTaskRequest(request);
    raw = multipart.raw;
    files = multipart.files;
  } else {
    raw = await request.json();
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    await removeTaskFiles(files.map((file) => file.storageKey));
    throw new Error(parsed.error.issues[0]?.message ?? "Проверьте данные задачи");
  }

  return { payload: parsed.data, files };
}

async function readMultipartTaskRequest(
  request: Request,
): Promise<{ raw: unknown; files: StoredTaskFile[] }> {
  if (!request.body) throw new Error("Не переданы данные задачи");

  const directory = await ensureTaskStorageDirectory();
  const files: StoredTaskFile[] = [];
  const writes: Promise<void>[] = [];
  let payloadValue: string | null = null;
  let parseError: Error | null = null;

  const parser = Busboy({
    headers: Object.fromEntries(request.headers),
    limits: {
      files: MAX_TASK_FILES,
      fileSize: MAX_TASK_FILE_SIZE,
      fields: 10,
      fieldSize: 1024 * 1024,
    },
  });

  parser.on("field", (name, value) => {
    if (name === "payload") payloadValue = value;
  });

  parser.on("file", (fieldName, stream, info) => {
    if (fieldName !== "files" || !info.filename) {
      stream.resume();
      return;
    }

    const storageKey = createTaskStorageKey();
    const file: StoredTaskFile = {
      name: info.filename.slice(0, 240) || "Файл",
      storageKey,
      mimeType: info.mimeType || "application/octet-stream",
      size: 0,
    };

    try {
      validateTaskFileMetadata({
        name: file.name,
        mimeType: file.mimeType,
        size: 0,
      });
    } catch (error) {
      parseError = error instanceof Error ? error : new Error(String(error));
      stream.resume();
      return;
    }

    files.push(file);
    stream.on("data", (chunk: Buffer) => {
      file.size += chunk.length;
    });
    stream.on("limit", () => {
      parseError = new Error(
        "Разрешены изображения, PDF, документы, таблицы, TXT, CSV, XML и ZIP до 300 МБ",
      );
    });

    writes.push(
      pipeline(stream, createWriteStream(path.join(directory, storageKey))).then(
        () => {
          if (stream.truncated || file.size > MAX_TASK_FILE_SIZE) {
            throw new Error(
              "Разрешены изображения, PDF, документы, таблицы, TXT, CSV, XML и ZIP до 300 МБ",
            );
          }
        },
      ),
    );
  });

  parser.on("filesLimit", () => {
    parseError = new Error(
      `Можно прикрепить не больше ${MAX_TASK_FILES} файлов`,
    );
  });

  try {
    await new Promise<void>((resolve, reject) => {
      parser.once("error", reject);
      parser.once("finish", resolve);
      Readable.fromWeb(request.body as never).pipe(parser);
    });
    await Promise.all(writes);

    if (parseError) throw parseError;
    if (payloadValue === null) throw new Error("Не переданы данные задачи");

    try {
      return { raw: JSON.parse(payloadValue), files };
    } catch {
      throw new Error("Некорректные данные задачи");
    }
  } catch (error) {
    await removeTaskFiles(files.map((file) => file.storageKey));
    throw error;
  }
}
