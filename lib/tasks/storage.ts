import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";

export const MAX_TASK_FILES = 6;
export const MAX_TASK_FILE_SIZE = 300 * 1024 * 1024;

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

export interface StoredTaskFile {
  name: string;
  storageKey: string;
  mimeType: string;
  size: number;
}

export function createTaskStorageKey() {
  return randomUUID();
}

export async function ensureTaskStorageDirectory() {
  const directory = taskStorageDirectory();
  await mkdir(directory, { recursive: true });
  return directory;
}

export function validateTaskFileMetadata({
  name,
  mimeType,
  size,
}: {
  name: string;
  mimeType: string;
  size: number;
}) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (
    (!allowedTypes.has(mimeType) && !allowedExtensions.has(extension)) ||
    size > MAX_TASK_FILE_SIZE
  ) {
    throw new Error(
      "Разрешены изображения, PDF, документы, таблицы, TXT, CSV и ZIP до 300 МБ",
    );
  }
}

export function validateTaskFiles(files: File[]) {
  if (files.length > MAX_TASK_FILES) {
    throw new Error(`Можно прикрепить не больше ${MAX_TASK_FILES} файлов`);
  }

  for (const file of files) {
    validateTaskFileMetadata({
      name: file.name,
      mimeType: file.type,
      size: file.size,
    });
  }
}

export async function removeTaskFiles(storageKeys: string[]) {
  await Promise.all(
    storageKeys.map((storageKey) =>
      unlink(path.join(taskStorageDirectory(), storageKey)).catch(() => undefined),
    ),
  );
}
