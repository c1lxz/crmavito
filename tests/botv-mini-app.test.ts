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
    expect(clientSource).toContain("Ссылка на Яндекс.Диск");
    expect(apiSource).toContain("createSessionFromUploadedPath");
    expect(apiSource).toContain("Readable.fromWeb");
    expect(apiSource).toContain("createSessionFromLink");
    expect(apiSource).toContain("listSessions");
    expect(aliasSource).toContain("@/app/api/botv/session/route");
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
    expect(clientSource).toContain("Чёрный");
    expect(clientSource).toContain("Белый");
    expect(clientSource).toContain("PanelTop");
    expect(clientSource).toContain("Описание");
    expect(clientSource).toContain("fixed inset-0 z-50");
    expect(clientSource).toContain("cursor-pointer");
    expect(clientSource).not.toContain("<Eye");
  });

  it("requests duplicate XML with a replacement phone", () => {
    expect(clientSource).toContain("JSON.stringify({ phone })");
    expect(clientSource).toContain("Создать XML с другим телефоном?");
    expect(clientSource).toContain("Скачать ещё");
  });

  it("can download many replacement-phone XML files from one prompt", () => {
    expect(clientSource).toContain("downloadReplacementXml");
    expect(clientSource).toContain("setReplacementPhone(\"\")");
    expect(clientSource).toContain("setReplacementXmlCount((count) => count + 1)");
    expect(clientSource).not.toContain("await downloadXml(replacementPhone); setPhonePromptOpen(false)");
  });

  it("shows saved unfinished sessions", () => {
    expect(clientSource).toContain("История сохранений");
    expect(clientSource).toContain("`${BOTV_API_BASE}?limit=12`");
    expect(clientSource).toContain("botv:lastSessionId");
    expect(clientSource).toContain("Можно продолжить работу без созданного XML");
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
    expect(photoRouteSource).not.toContain("resolvePhoto");
  });


  it("serves XML photos from static public URLs", () => {
    const cliSource = readFileSync(path.resolve(__dirname, "../botv/web/session_cli.py"), "utf8");

    expect(cliSource).toContain("_stage_public_photo");
    expect(cliSource).toContain("/v-static/botv/{session_id}/{target.name}");
    expect(cliSource).toContain("os.link(photo, target)");
  });
});
