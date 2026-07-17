import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { analyzeAvitoMarket, formatAvitoMarketError } from "@/lib/avito/market-analysis";

const HOST = process.env.AVITO_LOCAL_AGENT_HOST ?? "127.0.0.1";
const PORT = Number(process.env.AVITO_LOCAL_AGENT_PORT ?? 3217);

type JsonResponse = {
  status: number;
  body: unknown;
};

function sendJson(res: ServerResponse, response: JsonResponse) {
  res.writeHead(response.status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(response.body));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, { status: 204, body: null });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, { status: 200, body: { ok: true, service: "avito-local-agent" } });
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/avito/market-analysis/probe") {
    sendJson(res, { status: 404, body: { error: "Not found" } });
    return;
  }

  try {
    const body = await readJson(req);
    const category = typeof body.category === "string" ? body.category : "";
    const periodDays = Number(body.periodDays ?? 3);

    if (!category.trim() || !Number.isFinite(periodDays)) {
      sendJson(res, { status: 400, body: { error: "Укажите категорию и период." } });
      return;
    }

    const result = await analyzeAvitoMarket({ category, periodDays }, { timeoutMs: 20000 });
    sendJson(res, {
      status: 200,
      body: {
        ...result,
        notes: ["Запрос выполнен локальным агентом на этом компьютере.", ...result.notes],
      },
    });
  } catch (error) {
    sendJson(res, { status: 502, body: { error: formatAvitoMarketError(error) } });
  }
}).listen(PORT, HOST, () => {
  console.log(`Avito local agent listening on http://${HOST}:${PORT}`);
});
