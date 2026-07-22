import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const BACKGROUND_SLOTS = ["1", "2", "3"] as const;
export type BackgroundSlot = (typeof BACKGROUND_SLOTS)[number];

const allowedTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
const maxFileSize = 20 * 1024 * 1024;

export type StoredBackground = {
  slot: BackgroundSlot;
  fileName: string;
  mimeType: keyof typeof allowedTypes;
  size: number;
  updatedAt: string;
};

function backgroundDirectory() {
  return process.env.CONTENT_MACHINE_DATA_DIR?.trim()
    ? path.resolve(process.env.CONTENT_MACHINE_DATA_DIR, "backgrounds")
    : path.join(process.cwd(), "data", "content-machine", "backgrounds");
}

export function parseBackgroundSlot(value: unknown): BackgroundSlot | null {
  return typeof value === "string" && BACKGROUND_SLOTS.includes(value as BackgroundSlot)
    ? value as BackgroundSlot
    : null;
}

export function validateImageFile(file: File): asserts file is File & { type: keyof typeof allowedTypes } {
  if (!(file.type in allowedTypes) || file.size <= 0 || file.size > maxFileSize) {
    throw new Error("Разрешены JPG, PNG и WebP размером до 20 МБ.");
  }
}

export async function listBackgrounds(): Promise<Array<StoredBackground | null>> {
  await mkdir(backgroundDirectory(), { recursive: true });
  return Promise.all(BACKGROUND_SLOTS.map((slot) => findBackground(slot)));
}

export async function saveBackground(slot: BackgroundSlot, file: File): Promise<StoredBackground> {
  validateImageFile(file);
  const directory = backgroundDirectory();
  await mkdir(directory, { recursive: true });
  const extension = allowedTypes[file.type];
  const fileName = `background-${slot}.${extension}`;
  const target = path.join(directory, fileName);
  const temporary = path.join(directory, `.background-${slot}-${Date.now()}.${extension}`);
  await writeFile(temporary, Buffer.from(await file.arrayBuffer()));
  await rename(temporary, target);

  const files = await readdir(directory);
  await Promise.all(files
    .filter((name) => name.startsWith(`background-${slot}.`) && name !== fileName)
    .map((name) => unlink(path.join(directory, name)).catch(() => undefined)));

  const saved = await findBackground(slot);
  if (!saved) throw new Error("Не удалось сохранить фон.");
  return saved;
}

export async function readBackground(slot: BackgroundSlot): Promise<StoredBackground & { buffer: Buffer }> {
  const background = await findBackground(slot);
  if (!background) throw new Error(`Фон ${slot} ещё не загружен.`);
  return { ...background, buffer: await readFile(path.join(backgroundDirectory(), background.fileName)) };
}

async function findBackground(slot: BackgroundSlot): Promise<StoredBackground | null> {
  const directory = backgroundDirectory();
  await mkdir(directory, { recursive: true });
  const names = await readdir(directory);
  const fileName = names.find((name) => /^background-[123]\.(jpg|png|webp)$/.test(name) && name.startsWith(`background-${slot}.`));
  if (!fileName) return null;
  const extension = path.extname(fileName).slice(1);
  const mimeType = (Object.entries(allowedTypes).find(([, ext]) => ext === extension)?.[0] || "image/jpeg") as keyof typeof allowedTypes;
  const details = await stat(path.join(directory, fileName));
  return { slot, fileName, mimeType, size: details.size, updatedAt: details.mtime.toISOString() };
}
