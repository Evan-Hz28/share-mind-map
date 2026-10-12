/**
 * `crypto.randomUUID` 属于 secure context 专属 API,只有在 `https://` 或 `http://localhost`
 * 下才存在。用公网 IP 走明文 HTTP 访问时它是 `undefined`,调用即抛 `TypeError`。
 * `crypto.getRandomValues` 没有这个限制,所以用它手拼一个 RFC 4122 v4 UUID 作为兜底。
 */
export function randomUuid(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    // 非安全上下文里没有 randomUUID,继续走下面的兜底实现。
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex: string[] = [];
  for (const [index, byte] of bytes.entries()) {
    let value = byte;
    if (index === 6) value = (byte & 0x0f) | 0x40; // version 4
    if (index === 8) value = (byte & 0x3f) | 0x80; // variant 10xx
    hex.push(value.toString(16).padStart(2, "0"));
  }
  const joined = hex.join("");
  return [
    joined.slice(0, 8),
    joined.slice(8, 12),
    joined.slice(12, 16),
    joined.slice(16, 20),
    joined.slice(20),
  ].join("-");
}
