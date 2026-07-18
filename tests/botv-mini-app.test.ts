import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const clientSource = readFileSync(path.resolve(__dirname, "../components/botv/botv-mini-app.tsx"), "utf8");
const pageSource = readFileSync(path.resolve(__dirname, "../app/v/page.tsx"), "utf8");
const apiSource = readFileSync(path.resolve(__dirname, "../app/api/botv/session/route.ts"), "utf8");
const aliasSource = readFileSync(path.resolve(__dirname, "../app/v-data/botv/work/route.ts"), "utf8");
const autoloadStatusRouteSource = readFileSync(path.resolve(__dirname, "../app/api/avito/autoload/status/route.ts"), "utf8");
const autoloadStopRouteSource = readFileSync(path.resolve(__dirname, "../app/api/avito/autoload/stop/route.ts"), "utf8");

describe("botv mini app UI", () => {
  it("does not contain mojibake or replacement characters", () => {
    const mojibakeMarkers = [
      "\uFFFD",
      "\u0420\u045F",
      "\u0420\u040E",
      "\u0421\u0453",
      "\u0421\u201A",
      "\u0432\u201A\u00BD",
      "\u0412\u00B7",
    ];

    for (const marker of mojibakeMarkers) {
      expect(clientSource).not.toContain(marker);
    }
  });

  it("mounts on /v and uploads archives through botv API", () => {
    expect(pageSource).toContain("BotvMiniApp");
    expect(clientSource).toContain("/v-data/botv/work");
    expect(clientSource).toContain("Ссылка на Яндекс.Диск");
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
    expect(clientSource).toContain("Файл загружен, сервер распаковывает");
    expect(clientSource).toContain("formatBytes(uploadProgress.loaded)");
    expect(clientSource).toContain("uploadProgress.percent");
    expect(chunkRouteSource).toContain("action === \"chunk\"");
    expect(chunkRouteSource).toContain("action === \"finalize\"");
  });

  it("supports the requested listing workflow", () => {
    expect(clientSource).toContain("Название из папки");
    expect(clientSource).toContain("Одна цена");
    expect(clientSource).toContain("deleteSelected");
    expect(clientSource).toContain("Как на Avito");
    expect(clientSource).toContain("firstPhoto");
    expect(clientSource).toContain("setPhonePromptOpen(true)");
    expect(clientSource).toContain("movePhoto");
    expect(clientSource).toContain("PRODUCT_COLORS");
    expect(clientSource).toContain("saveProductColor");
    expect(clientSource).toContain("dropStockInput");
    expect(clientSource).toContain("saveDropStockQuantity");
    expect(clientSource).toContain("dropStockQuantity");
    expect(clientSource).toContain("Остаток XML");
    expect(clientSource).toContain("Чёрный");
    expect(clientSource).toContain("Белый");
    expect(clientSource).toContain("PanelTop");
    expect(clientSource).toContain("Описание");
    expect(clientSource).toContain("fixed inset-0 z-50");
    expect(clientSource).toContain("cursor-pointer");
    expect(clientSource).not.toContain("<Eye");
  });

  it("edits per-listing XML descriptions", () => {
    expect(clientSource).toContain("Textarea");
    expect(clientSource).toContain("saveProductDescription");
    expect(clientSource).toContain("description: e.target.value");
    expect(clientSource).toContain("saveProductDescription(product.index, e.currentTarget.value)");
    expect(clientSource).toContain("Описание для XML");
  });

  it("requests duplicate XML with a replacement phone", () => {
    const xmlRouteSource = readFileSync(path.resolve(__dirname, "../app/api/botv/session/[id]/xml/route.ts"), "utf8");
    const xmlAliasSource = readFileSync(path.resolve(__dirname, "../app/v-data/botv/work/[id]/xml/route.ts"), "utf8");

    expect(clientSource).toContain("JSON.stringify({ phone })");
    expect(clientSource).toContain("Создать XML с другим телефоном?");
    expect(clientSource).toContain("Скачать ещё");
    expect(xmlRouteSource).not.toContain("\"x-botv-ad-ids\"");
    expect(xmlRouteSource).toContain("export async function GET");
    expect(xmlAliasSource).toContain("GET as apiGET");
  });

  it("can download many replacement-phone XML files from one prompt", () => {
    expect(clientSource).toContain("downloadReplacementXml");
    expect(clientSource).toContain("setReplacementPhone(\"\")");
    expect(clientSource).toContain("setReplacementXmlCount((count) => count + 1)");
    expect(clientSource).toContain("ID последнего XML");
    expect(clientSource).toContain("parseAdIdsXml(await blob.text())");
    expect(clientSource).toContain("manualPublishCredentialsComplete ? manualPublishClientId.trim() : selectedPublishProfileId");
    expect(clientSource).toContain("!publishLegacyIds && (!hasPublishAuth || manualPublishCredentialsPartial)");
    expect(clientSource).not.toContain("await downloadXml(replacementPhone); setPhonePromptOpen(false)");
  });

  it("shows saved unfinished sessions", () => {
    expect(clientSource).toContain("История сохранений");
    expect(clientSource).toContain("`${BOTV_API_BASE}?limit=12`");
    expect(clientSource).toContain("botv:lastSessionId");
    expect(clientSource).toContain("Можно продолжить работу без созданного XML");
  });

  it("adds Avito publication controls with saved profiles or manual keys", () => {
    const publishRouteSource = readFileSync(path.resolve(__dirname, "../app/api/botv/session/[id]/publish/route.ts"), "utf8");

    expect(clientSource).toContain("Публикация");
    expect(clientSource).toContain("publishXml");
    expect(clientSource).toContain("publishResult");
    expect(clientSource).toContain("setPublishResult({ ...(data.publish ?? {}), adIds, legacyIds: Boolean(data.legacyIds) })");
    expect(clientSource).toContain("Публикация Avito запущена");
    expect(clientSource).toContain("ID опубликованных объявлений");
    expect(clientSource).toContain("const adIds");
    expect(clientSource).toContain("XML и публикация со старыми ID");
    expect(clientSource).toContain("legacyIds: publishLegacyIds");
    expect(clientSource).toContain("Новые дропы скачивайте и публикуйте без этой галочки");
    expect(clientSource).toContain("Итог публикации появится в отчётах Автозагрузки Avito");
    expect(clientSource).toContain("checkAutoloadStatus");
    expect(clientSource).toContain("/api/avito/autoload/status");
    expect(clientSource).toContain("Статус автозагрузки Avito");
    expect(clientSource).toContain("Разбивка текущей загрузки");
    expect(clientSource).toContain("Последние запуски");
    expect(autoloadStatusRouteSource).toContain("fetchAvitoAutoloadStatus");
    expect(clientSource).toContain("publishAuthPayload");
    expect(clientSource).toContain("manualPublishClientId");
    expect(clientSource).toContain("manualPublishClientSecret");
    expect(clientSource).toContain("manualPublishReportEmail");
    expect(clientSource).toContain("manualPublishContactPhone");
    expect(clientSource).toContain("contactPhone: manualPublishContactPhone.trim() || null");
    expect(clientSource).toContain("Email отчётов XML");
    expect(clientSource).toContain("Телефон XML вручную");
    expect(clientSource).toContain("stopAutoload");
    expect(clientSource).toContain("/api/avito/autoload/stop");
    expect(clientSource).toContain("Остановить");
    expect(autoloadStopRouteSource).toContain("disableAvitoAutoload");
    expect(clientSource).toContain("/api/avito-profiles/credentials");
    expect(clientSource).toContain("publishProfiles");
    expect(clientSource).toContain("selectedPublishProfileId");
    expect(clientSource).not.toContain("publishReportEmail");
    expect(clientSource).not.toContain("Email отчётов Avito *");
    expect(clientSource).not.toContain("crmavito:botv-publish-credentials");
    expect(clientSource).not.toContain("profileName");
    expect(publishRouteSource).toContain("publishAvitoXml");
    expect(publishRouteSource).toContain("publicXmlFeedUrl");
    expect(publishRouteSource).toContain("/v-data/botv/work/");
    expect(publishRouteSource).toContain("url.searchParams.set(\"profileId\", profileId)");
    expect(publishRouteSource).toContain("legacyIds");
    expect(publishRouteSource).toContain("parsed.data.legacyIds ? null : (parsed.data.profileId || parsed.data.clientId)");
    expect(publishRouteSource).toContain("parsed.data.reportEmail");
    expect(publishRouteSource).toContain("parsed.data.contactPhone");
    expect(publishRouteSource).toContain("getAvitoCredentials");
    expect(publishRouteSource).toContain("getAvitoProfileAutoloadSettings");
    expect(publishRouteSource).toContain("buildXml(id, contactPhone, { profileId: profileScope })");
    expect(publishRouteSource).toContain("adIds: xmlResult.adIds");
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
    expect(clientSource).toContain("Сервер временно не ответил");
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
