import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type FlowAgentState = "ready" | "blocked" | "auth_required" | "error";

export type FlowAgentStatus = {
  agentId: string;
  state: FlowAgentState;
  message: string;
  checkedAt: string;
  concurrency: number;
};

function statusPath() {
  const root = process.env.CONTENT_MACHINE_DATA_DIR?.trim()
    ? path.resolve(process.env.CONTENT_MACHINE_DATA_DIR)
    : path.join(process.cwd(), "data", "content-machine");
  return path.join(root, "flow-agent-status.json");
}

export async function saveFlowAgentStatus(status: FlowAgentStatus) {
  const filePath = statusPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(status, null, 2), "utf8");
  await rename(temporary, filePath);
}

export async function readFlowAgentStatus() {
  try {
    const status = JSON.parse(await readFile(statusPath(), "utf8")) as FlowAgentStatus;
    const online = Date.now() - Date.parse(status.checkedAt) < 45_000;
    return { ...status, online };
  } catch {
    return {
      agentId: null,
      state: "error" as const,
      message: "Локальный Flow-агент ещё не подключался.",
      checkedAt: null,
      concurrency: 0,
      online: false,
    };
  }
}
