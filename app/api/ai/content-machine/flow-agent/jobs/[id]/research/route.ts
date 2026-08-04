import { saveFlowJobResearch } from "@/lib/ai/content-machine-jobs";
import { authorizeFlowAgent, flowAgentUnauthorized } from "@/lib/ai/flow-agent-auth";
import { MARKET_SOURCES, type MarketResearch } from "@/lib/flow-agent/market-research";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!authorizeFlowAgent(request)) return flowAgentUnauthorized();
  try {
    const { id } = await context.params;
    const body = await request.json() as { agentId?: string; research?: MarketResearch };
    if (!body.agentId || !body.research || typeof body.research.query !== "string" || !Array.isArray(body.research.listings)) {
      return Response.json({ error: "Некорректный отчёт исследования рынка." }, { status: 400 });
    }
    const submittedResearch = body.research;
    const research: MarketResearch = {
      query: submittedResearch.query.slice(0, 120),
      checkedAt: submittedResearch.checkedAt || new Date().toISOString(),
      listings: submittedResearch.listings
        .filter((listing) => {
          if (!MARKET_SOURCES.includes(listing.source) || typeof listing.title !== "string" || typeof listing.url !== "string") return false;
          try {
            return ["https:"].includes(new URL(listing.url).protocol);
          } catch {
            return false;
          }
        })
        .slice(0, 30)
        .map((listing) => ({
          source: listing.source,
          title: listing.title.slice(0, 180),
          url: listing.url,
          ...(typeof listing.price === "string" ? { price: listing.price.slice(0, 40) } : {}),
          ...(isTrustedMarketImage(listing.imageUrl) ? { imageUrl: listing.imageUrl } : {}),
        })),
      topSignals: Array.isArray(submittedResearch.topSignals) ? submittedResearch.topSignals.slice(0, 12) : [],
      sourceCounts: Object.fromEntries(MARKET_SOURCES.map((source) => [
        source,
        Number.isFinite(submittedResearch.sourceCounts?.[source]) ? Math.max(0, submittedResearch.sourceCounts[source]) : 0,
      ])) as MarketResearch["sourceCounts"],
    };
    const job = await saveFlowJobResearch(id, body.agentId, research);
    return Response.json({ job });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

function isTrustedMarketImage(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["media-assets.grailed.com", "static.mercdn.net", "img.fril.jp"]
      .some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}
