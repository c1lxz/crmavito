import { describe, expect, it } from "vitest";
import { publicFlowAgentError, sanitizeFlowAgentError } from "@/lib/flow-agent/errors";

describe("Flow agent error redaction", () => {
  it("removes cookies, session tokens and signed URL values", () => {
    const unsafe = [
      "apiRequestContext.get: Timeout 30000ms exceeded.",
      "  - cookie: EMAIL=user@example.com; __Secure-next-auth.session-token=secret-value",
      "  - GET https://flow-content.google/image/id?Signature=signed-secret&Key=key-secret",
      "  - authorization: Bearer private-token",
    ].join("\n");

    const sanitized = sanitizeFlowAgentError(unsafe);
    expect(sanitized).not.toContain("secret-value");
    expect(sanitized).not.toContain("signed-secret");
    expect(sanitized).not.toContain("key-secret");
    expect(sanitized).not.toContain("private-token");
    expect(publicFlowAgentError(unsafe)).toBe(
      "Flow сгенерировал изображение, но агент не успел скачать результат. Загрузка будет повторена.",
    );
  });
});
