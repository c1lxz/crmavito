import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Flow local agent installer", () => {
  it("is exposed from the Content Machine as a Windows EXE", async () => {
    const client = await readFile(path.join(root, "components/content-machine/content-machine-client.tsx"), "utf8");
    expect(client).toContain('href="/downloads/install-flow-agent.exe"');
    expect(client).toContain("Локальный агент Flow");
    expect(client).toContain("Скачать для Windows");
  });

  it("installs a bundled agent with autostart and a private local config", async () => {
    const installer = await readFile(path.join(root, "public/downloads/install-flow-agent.ps1"), "utf8");
    const ensure = await readFile(path.join(root, "scripts/flow-agent-runtime/ensure-flow-agent.ps1"), "utf8");
    const builder = await readFile(path.join(root, "scripts/build-flow-agent-installer.ps1"), "utf8");
    expect(installer).toContain("Register-ScheduledTask");
    expect(installer).toContain("current-user-run");
    expect(installer).toContain('"FLOW_LOCAL_AGENT_TOKEN=$token"');
    expect(installer).toContain("FLOW_AGENT_INSTALL_OK");
    expect(ensure).toContain("dist\\flow-agent.cjs");
    expect(ensure).toContain("FLOW_AGENT_PROFILE_DIR");
    expect(builder).toContain("UTF8Encoding($true)");
    expect(builder).toContain("GetEncoding(1251)");
    expect(builder).not.toContain("WINDOWS 10/11");
    expect(builder).not.toContain("Адрес CRM");
    expect(builder).not.toContain("Ключ подключения");
    expect(builder).not.toContain("new TextBox");
  });

  it("ships the generated executable and agent package", async () => {
    const [exe, zip] = await Promise.all([
      stat(path.join(root, "public/downloads/install-flow-agent.exe")),
      stat(path.join(root, "public/downloads/flow-agent.zip")),
    ]);
    expect(exe.size).toBeGreaterThan(50_000);
    expect(zip.size).toBeGreaterThan(10_000);
  });
});
