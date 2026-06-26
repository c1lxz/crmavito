import { createHmac } from "crypto";

export function validateTelegramInitData(
  initData: string,
  botToken: string
): { id: number; first_name: string; last_name?: string; username?: string } | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    params.delete("hash");

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (computedHash !== hash) return null;

    const authDate = parseInt(params.get("auth_date") ?? "0");
    if (Date.now() / 1000 - authDate > 86400) return null;

    const userStr = params.get("user");
    if (!userStr) return null;

    return JSON.parse(userStr);
  } catch {
    return null;
  }
}
