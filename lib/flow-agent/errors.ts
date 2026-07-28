export function sanitizeFlowAgentError(error: unknown, maxLength = 2_000) {
  const raw = error instanceof Error ? error.stack || error.message : String(error);
  const sanitized = raw
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/^.*(?:cookie|set-cookie|authorization):.*$/gim, "  - sensitive request headers: [redacted]")
    .replace(/([?&](?:signature|token|key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(__Secure-[^=;\s]+|__Host-[^=;\s]+)=([^;\s]+)/gi, "$1=[redacted]")
    .replace(/\beyJ[a-zA-Z0-9._-]{40,}\b/g, "[redacted-token]");
  return sanitized.slice(0, maxLength);
}

export function publicFlowAgentError(error: unknown) {
  const sanitized = sanitizeFlowAgentError(error);
  if (/apiRequestContext\.get: Timeout|download.*timed out|Timeout \d+ms exceeded/i.test(sanitized)) {
    return "Flow сгенерировал изображение, но агент не успел скачать результат. Загрузка будет повторена.";
  }
  return sanitized.split("\n").slice(0, 4).join("\n");
}
