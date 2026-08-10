import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

const ENROLLMENT_TTL_MS = 15 * 60 * 1000;

type EnrollmentRecord = {
  userId: string;
  expiresAt: string;
};

type AgentTokenRecord = {
  agentId: string;
  userId: string;
  createdAt: string;
};

function storageRoot() {
  const root = process.env.CONTENT_MACHINE_DATA_DIR?.trim()
    ? path.resolve(process.env.CONTENT_MACHINE_DATA_DIR)
    : path.join(process.cwd(), "data", "content-machine");
  return path.join(root, "flow-agent-auth");
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function createFlowAgentEnrollment(userId: string) {
  const rawCode = randomBytes(6).toString("hex").toUpperCase();
  const code = rawCode.match(/.{1,4}/g)!.join("-");
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS).toISOString();
  const directory = path.join(storageRoot(), "enrollments");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${digest(rawCode)}.json`),
    JSON.stringify({ userId, expiresAt } satisfies EnrollmentRecord),
    { encoding: "utf8", flag: "wx" },
  );
  return { code, expiresAt };
}

export async function consumeFlowAgentEnrollment(code: string, agentId: string) {
  const normalizedCode = normalizeCode(code);
  const normalizedAgentId = agentId.trim().slice(0, 100);
  if (normalizedCode.length !== 12 || !normalizedAgentId) throw new Error("Неверный код подключения.");

  const enrollmentPath = path.join(storageRoot(), "enrollments", `${digest(normalizedCode)}.json`);
  const consumingPath = `${enrollmentPath}.${randomBytes(6).toString("hex")}.consuming`;
  try {
    await rename(enrollmentPath, consumingPath);
  } catch {
    throw new Error("Код подключения недействителен или уже использован.");
  }

  try {
    const record = JSON.parse(await readFile(consumingPath, "utf8")) as EnrollmentRecord;
    if (!record.userId || new Date(record.expiresAt).getTime() <= Date.now()) {
      throw new Error("Срок действия кода подключения истёк.");
    }
    const token = randomBytes(32).toString("base64url");
    const tokenDirectory = path.join(storageRoot(), "tokens");
    await mkdir(tokenDirectory, { recursive: true });
    await writeFile(
      path.join(tokenDirectory, `${digest(token)}.json`),
      JSON.stringify({ agentId: normalizedAgentId, userId: record.userId, createdAt: new Date().toISOString() } satisfies AgentTokenRecord),
      { encoding: "utf8", flag: "wx" },
    );
    return token;
  } finally {
    await unlink(consumingPath).catch(() => undefined);
  }
}

export function authorizeEnrolledFlowAgent(token: string, agentId: string) {
  if (!token || !agentId.trim()) return false;
  try {
    const record = JSON.parse(readFileSync(path.join(storageRoot(), "tokens", `${digest(token)}.json`), "utf8")) as AgentTokenRecord;
    const left = Buffer.from(record.agentId);
    const right = Buffer.from(agentId.trim());
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}
