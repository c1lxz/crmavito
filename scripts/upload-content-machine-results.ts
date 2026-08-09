import { hostname } from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const jobId = process.argv[2]?.trim();
const resultDirectory = process.argv[3]?.trim();
if (!jobId || !resultDirectory) {
  throw new Error("Usage: tsx scripts/upload-content-machine-results.ts <job-id> <result-directory>");
}

const baseUrl = (process.env.FLOW_AGENT_CRM_URL || "https://crmavito.duckdns.org").replace(/\/+$/, "");
const token = process.env.FLOW_LOCAL_AGENT_TOKEN?.trim();
const agentId = `reviewed-upload-${hostname()}-${process.pid}`;
if (!token) throw new Error("FLOW_LOCAL_AGENT_TOKEN is not configured.");

async function main() {
  const claim = await agentFetch("/api/ai/content-machine/flow-agent/jobs/next", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  const claimed = await claim.json() as { job?: { id?: string } | null; error?: string };
  if (!claim.ok || claimed.job?.id !== jobId) {
    throw new Error(claimed.error || `Expected ${jobId}, got ${claimed.job?.id || "none"}.`);
  }

  try {
    for (const slot of ["1", "2", "3", "4"] as const) {
      const filePath = path.resolve(resultDirectory, `product-01-background-${slot}.png`);
      const source = await readFile(filePath);
      const form = new FormData();
      form.set("agentId", agentId);
      form.set("productIndex", "1");
      form.set("backgroundSlot", slot);
      form.set("startedAt", new Date().toISOString());
      form.set("durationMs", "0");
      form.set("uploadMs", "0");
      form.set("generationMs", "0");
      form.set("file", new Blob([new Uint8Array(source)], { type: "image/png" }), path.basename(filePath));
      const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/result`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error(`Result ${slot}: CRM HTTP ${response.status} ${await response.text()}`);
      console.log(`[reviewed-upload] ${jobId}: uploaded ${slot}/4`);
    }
  } catch (error) {
    await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, error: error instanceof Error ? error.message : String(error) }),
    }).catch(() => undefined);
    throw error;
  }
}

function agentFetch(route: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(`${baseUrl}${route}`, { ...init, headers, signal: AbortSignal.timeout(180_000) });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
