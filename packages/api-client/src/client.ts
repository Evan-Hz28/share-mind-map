import { createClient, type Client } from "./generated/client/index.js";

const unsafeMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);

// `crypto.randomUUID` 是 secure context 专属 API,明文 HTTP + 公网 IP 下它是 undefined,
// 直接调用会抛 TypeError;`crypto.getRandomValues` 没有这个限制,用它手拼 v4 UUID 兜底。
function randomRequestId(): string {
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

export interface CreateApiClientOptions {
  baseUrl: string;
  getCsrfToken(): string | undefined;
  onUnauthorized?(): void | Promise<void>;
}

export interface ApiClientConfig {
  readonly baseUrl: string;
  readonly credentials: "include";
}

export type ApiClient = Client & { readonly config: ApiClientConfig };

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const config: ApiClientConfig = Object.freeze({
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    credentials: "include",
  });
  const client = createClient(config);

  client.interceptors.request.use((request) => {
    const headers = new Headers(request.headers);
    if (!headers.has("X-Request-ID")) headers.set("X-Request-ID", randomRequestId());
    const csrfToken = unsafeMethods.has(request.method) ? options.getCsrfToken() : undefined;
    if (csrfToken !== undefined && !headers.has("X-CSRF-Token")) {
      headers.set("X-CSRF-Token", csrfToken);
    }
    return new Request(request, { headers });
  });

  if (options.onUnauthorized !== undefined) {
    client.interceptors.response.use(async (response) => {
      if (response.status === 401) await options.onUnauthorized?.();
      return response;
    });
  }

  return Object.defineProperty(client, "config", {
    enumerable: true,
    value: config,
    writable: false,
  }) as ApiClient;
}
