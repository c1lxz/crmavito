import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_TASK_FILES = 6;
export const MAX_TASK_FILE_SIZE = 15 * 1024 * 1024;

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
]);

const allowedExtensions = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "pdf",
  "txt",
  "csv",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "zip",
]);

export function taskStorageDirectory() {
  return path.join(process.cwd(), "storage", "tasks");
}

export function validateTaskFiles(files: File[]) {
  if (files.length > MAX_TASK_FILES) {
    throw new Error(`Можно прикрепить не больше ${MAX_TASK_FILES} файлов`);
  }

  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (
      (!allowedTypes.has(file.type) && !allowedExtensions.has(extension)) ||
      file.size > MAX_TASK_FILE_SIZE
    ) {
      throw new Error(
        "Разрешены изображения, PDF, документы, таблицы, TXT, CSV и ZIP до 15 МБ",
      );
    }
  }
}

export async function saveTaskFiles(files: File[]) {
  validateTaskFiles(files);
  const directory = taskStorageDirectory();
  await mkdir(directory, { recursive: true });
  const saved: Array<{
    name: string;
    storageKey: string;
    mimeType: string;
    size: number;
  }> = [];

  for (const file of files) {
    const storageKey = randomUUID();
    await writeFile(
      path.join(directory, storageKey),
      Buffer.from(await file.arrayBuffer()),
    );
    saved.push({
      name: file.name.slice(0, 240) || "Файл",
      storageKey,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    });
  }

  return saved;
}

export async function removeTaskFiles(storageKeys: string[]) {
  await Promise.all(
    storageKeys.map((storageKey) =>
      unlink(path.join(taskStorageDirectory(), storageKey)).catch(() => undefined),
    ),
  );
}
