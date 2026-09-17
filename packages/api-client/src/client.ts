import { createClient, type Client } from "./generated/client/index.js";

const unsafeMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);

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
    if (!headers.has("X-Request-ID")) headers.set("X-Request-ID", globalThis.crypto.randomUUID());
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
