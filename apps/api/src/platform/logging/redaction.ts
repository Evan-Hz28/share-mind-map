const redacted = "[REDACTED]";
const sensitiveKeys = new Set([
  "authorization",
  "clientsecret",
  "cookie",
  "currentpassword",
  "document",
  "image",
  "newpassword",
  "password",
  "passwordhash",
  "secret",
  "sessionid",
  "sessionsecret",
  "sessiontoken",
  "setcookie",
  "snapshot",
  "temporarypassword",
  "token",
  "xcsrftoken",
]);

function normalizedKey(key: string): string {
  return key.replaceAll(/[-_]/g, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    sensitiveKeys.has(normalized) ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token") ||
    normalized.endsWith("credential") ||
    normalized.endsWith("credentials") ||
    normalized.endsWith("apikey") ||
    /^(document|image|snapshot)(body|bytes|content|data|json)$/.test(normalized)
  );
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return redacted;
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? redacted : redactValue(entry, seen),
    ]),
  );
}

export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}
