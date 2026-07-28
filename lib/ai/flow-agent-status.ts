import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type FlowAgentState = "ready" | "blocked" | "auth_required" | "error";

export type FlowAgentStatus = {
  agentId: string;
  state: FlowAgentState;
  message: string;
  checkedAt: string;
  concurrency: number;
};

function dataRoot() {
  const root = process.env.CONTENT_MACHINE_DATA_DIR?.trim()
    ? path.resolve(process.env.CONTENT_MACHINE_DATA_DIR)
    : path.join(process.cwd(), "data", "content-machine");
  return root;
}

function statusDirectory() {
  return path.join(dataRoot(), "flow-agent-status");
}

export async function saveFlowAgentStatus(status: FlowAgentStatus) {
  const safeAgentId = status.agentId.replace(/[^a-z0-9._-]/gi, "_").slice(0, 100);
  const filePath = path.join(statusDirectory(), `${safeAgentId}.json`);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(status, null, 2), "utf8");
  await rename(temporary, filePath);
}

export async function readFlowAgentStatus() {
  const statuses: FlowAgentStatus[] = [];
  try {
    const files = (await readdir(statusDirectory())).filter((name) => name.endsWith(".json"));
    statuses.push(...await Promise.all(files.map(async (name) =>
      JSON.parse(await readFile(path.join(statusDirectory(), name), "utf8")) as FlowAgentStatus
    )));
  } catch {
    // The directory is created by the first heartbeat.
  }
  try {
    statuses.push(JSON.parse(await readFile(path.join(dataRoot(), "flow-agent-status.json"), "utf8")) as FlowAgentStatus);
  } catch {
    // Legacy single-agent heartbeat is optional.
  }
  const valid = statuses
    .filter((status) => status?.agentId && Number.isFinite(Date.parse(status.checkedAt)))
    .map((status) => ({ ...status, online: Date.now() - Date.parse(status.checkedAt) < 45_000 }))
    .sort((left, right) => {
      const leftPriority = Number(left.online && left.state === "ready") * 2 + Number(left.online);
      const rightPriority = Number(right.online && right.state === "ready") * 2 + Number(right.online);
      return rightPriority - leftPriority || Date.parse(right.checkedAt) - Date.parse(left.checkedAt);
    });
  if (valid[0]) {
    return { ...valid[0], agentsOnline: valid.filter((status) => status.online).length };
  }
  return {
    agentId: null,
    state: "error" as const,
    message: "Локальный Flow-агент ещё не подключался.",
    checkedAt: null,
    concurrency: 0,
    online: false,
    agentsOnline: 0,
  };
}
