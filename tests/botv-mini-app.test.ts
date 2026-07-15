import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const clientSource = readFileSync(path.resolve(__dirname, "../components/botv/botv-mini-app.tsx"), "utf8");
const pageSource = readFileSync(path.resolve(__dirname, "../app/v/page.tsx"), "utf8");
const apiSource = readFileSync(path.resolve(__dirname, "../app/api/botv/session/route.ts"), "utf8");
const aliasSource = readFileSync(path.resolve(__dirname, "../app/v-data/botv/work/route.ts"), "utf8");

describe("botv mini app UI", () => {
  it("mounts on /v and uploads archives through botv API", () => {
    expect(pageSource).toContain("BotvMiniApp");
    expect(clientSource).toContain("/v-data/botv/work");
    expect(clientSource).toContain("РЎСЃС‹Р»РєР° РЅР° РЇРЅРґРµРєСЃ.Р”РёСЃРє");
    expect(apiSource).toContain("createSessionFromUploadedPath");
    expect(apiSource).toContain("Readable.fromWeb");
    expect(apiSource).toContain("createSessionFromLink");
    expect(apiSource).toContain("listSessions");
    expect(aliasSource).toContain("@/app/api/botv/session/route");
  });

  it("shows archive upload progress before server processing", () => {
    const chunkRouteSource = readFileSync(path.resolve(__dirname, "../app/api/botv/session/chunk/route.ts"), "utf8");

    expect(clientSource).toContain("UploadProgress");
    expect(clientSource).toContain("UPLOAD_CHUNK_BYTES");
    expect(clientSource).toContain("UPLOAD_CHUNK_DELAY_MS");
    expect(clientSource).toContain("UPLOAD_CHUNK_RETRIES");
    expect(clientSource).toContain("sendUploadChunk");
    expect(clientSource).toContain("finalizeChunkUpload");
    expect(clientSource).toContain("Р¤Р°Р№Р» Р·Р°РіСЂСѓР¶РµРЅ, СЃРµСЂРІРµСЂ СЂР°СЃРїР°РєРѕРІС‹РІР°РµС‚");
    expect(clientSource).toContain("formatBytes(uploadProgress.loaded)");
    expect(clientSource).toContain("uploadProgress.percent");
    expect(chunkRouteSource).toContain("action === \"chunk\"");
    expect(chunkRouteSource).toContain("action === \"finalize\"");
  });

  it("supports the requested listing workflow", () => {
    expect(clientSource).toContain("РќР°Р·РІР°РЅРёРµ РёР· РїР°РїРєРё");
    expect(clientSource).toContain("РћРґРЅР° С†РµРЅР°");
    expect(clientSource).toContain("deleteSelected");
    expect(clientSource).toContain("РљР°Рє РЅР° Avito");
    expect(clientSource).toContain("firstPhoto");
    expect(clientSource).toContain("setPhonePromptOpen(true)");
    expect(clientSource).toContain("movePhoto");
    expect(clientSource).toContain("PRODUCT_COLORS");
    expect(clientSource).toContain("saveProductColor");
    expect(clientSource).toContain("Чёрный");
    expect(clientSource).toContain("Белый");
    expect(clientSource).toContain("PanelTop");
    expect(clientSource).toContain("РћРїРёСЃР°РЅРёРµ");
    expect(clientSource).toContain("fixed inset-0 z-50");
    expect(clientSource).toContain("cursor-pointer");
    expect(clientSource).not.toContain("<Eye");
  });

  it("requests duplicate XML with a replacement phone", () => {
    expect(clientSource).toContain("JSON.stringify({ phone })");
    expect(clientSource).toContain("РЎРѕР·РґР°С‚СЊ XML СЃ РґСЂСѓРіРёРј С‚РµР»РµС„РѕРЅРѕРј?");
    expect(clientSource).toContain("РЎРєР°С‡Р°С‚СЊ РµС‰С‘");
  });

  it("can download many replacement-phone XML files from one prompt", () => {
    expect(clientSource).toContain("downloadReplacementXml");
    expect(clientSource).toContain("setReplacementPhone(\"\")");
    expect(clientSource).toContain("setReplacementXmlCount((count) => count + 1)");
    expect(clientSource).not.toContain("await downloadXml(replacementPhone); setPhonePromptOpen(false)");
  });

  it("shows saved unfinished sessions", () => {
    expect(clientSource).toContain("РСЃС‚РѕСЂРёСЏ СЃРѕС…СЂР°РЅРµРЅРёР№");
    expect(clientSource).toContain("`${BOTV_API_BASE}?limit=12`");
    expect(clientSource).toContain("botv:lastSessionId");
    expect(clientSource).toContain("РњРѕР¶РЅРѕ РїСЂРѕРґРѕР»Р¶РёС‚СЊ СЂР°Р±РѕС‚Сѓ Р±РµР· СЃРѕР·РґР°РЅРЅРѕРіРѕ XML");
  });

  it("adds Avito publication controls with saved server profiles", () => {
    const publishRouteSource = readFileSync(path.resolve(__dirname, "../app/api/botv/session/[id]/publish/route.ts"), "utf8");

    expect(clientSource).toContain("РџСѓР±Р»РёРєР°С†РёСЏ");
    expect(clientSource).toContain("publishXml");
    expect(clientSource).toContain("/api/avito-profiles/credentials");
    expect(clientSource).toContain("publishProfiles");
    expect(clientSource).toContain("selectedPublishProfileId");
    expect(clientSource).not.toContain("crmavito:botv-publish-credentials");
    expect(clientSource).not.toContain("profileName");
    expect(publishRouteSource).toContain("publishAvitoXml");
    expect(publishRouteSource).toContain("fetchAvitoAccountProfile");
    expect(publishRouteSource).toContain("saveAvitoProfileCredentials");
    expect(publishRouteSource).toContain("getAvitoCredentials");
    expect(publishRouteSource).toContain("buildXml(id)");
  });

  it("does not render saved-progress messages that shift the toolbar", () => {
    expect(clientSource).not.toContain("hideSavedProgress");
    expect(clientSource).not.toContain("setHideSavedProgress");
    expect(clientSource).not.toContain("visibleProgress.map");
  });

  it("keeps Python CLI UTF-8 output intact", () => {
    const sessionSource = readFileSync(path.resolve(__dirname, "../lib/botv/session.ts"), "utf8");

    expect(sessionSource).toContain("stdoutChunks: Buffer[]");
    expect(sessionSource).toContain("Buffer.concat(stdoutChunks).toString(\"utf8\")");
    expect(sessionSource).not.toContain("stdout += chunk");
  });

  it("retries transient API fetch failures", () => {
    expect(clientSource).toContain("async function apiFetch");
    expect(clientSource).toContain("РЎРµСЂРІРµСЂ РІСЂРµРјРµРЅРЅРѕ РЅРµ РѕС‚РІРµС‚РёР»");
    expect(clientSource).toContain("await wait(500 * (attempt + 1))");
    expect(clientSource).toContain("readJsonResponse");
    expect(clientSource).not.toContain("Failed to fetch");
    expect(clientSource).not.toContain("await fetch(`/api/botv/session/${session.id}`");
    expect(clientSource).not.toContain('fetch("/api/botv/session');
  });

  it("keeps edits fast and avoids per-photo Python hops", () => {
    const photoRouteSource = readFileSync(path.resolve(__dirname, "../app/api/botv/session/[id]/photo/route.ts"), "utf8");
    const photoResponseSource = readFileSync(path.resolve(__dirname, "../lib/botv/photo-response.ts"), "utf8");

    expect(clientSource).toContain("function updateLocalProduct");
    expect(clientSource).toContain("void refreshHistory()");
    expect(clientSource).toContain("saveProductTitle(product.index, e.currentTarget.value)");
    expect(clientSource).toContain("saveProductColor(product, color)");
    expect(clientSource).toContain("manualColorOverrides");
    expect(clientSource).toContain("toggleOriginalTitle(product)");
    expect(clientSource).toContain('loading="lazy"');
    expect(clientSource).toContain('params.set("thumb", "1")');
    expect(clientSource).toContain("size: 160");
    expect(photoRouteSource).toContain("serveBotvPhoto");
    expect(photoResponseSource).toContain("decodePhotoToken");
    expect(photoResponseSource).toContain("sharp(filePath)");
    expect(photoResponseSource).toContain(".thumbs");
    expect(photoResponseSource).toContain("resize");
    expect(photoResponseSource).toContain("return serveOriginal(filePath, ext)");
    expect(photoResponseSource).toContain("return await serveThumbnail");
    expect(photoRouteSource).not.toContain("resolvePhoto");
  });


  it("serves XML photos from static public URLs", () => {
    const cliSource = readFileSync(path.resolve(__dirname, "../botv/web/session_cli.py"), "utf8");

    expect(cliSource).toContain("_stage_public_photo");
    expect(cliSource).toContain("/v-static/botv/{session_id}/{target.name}");
    expect(cliSource).toContain("os.link(photo, target)");
  });
});
