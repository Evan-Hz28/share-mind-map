import { createApiClient, type ApiErrorEnvelope } from "@share-mind-map/api-client";

type ApiFailure = ApiErrorEnvelope["error"];

let readCsrfToken: () => string | undefined = () => undefined;
let handleUnauthorized: () => void | Promise<void> = () => undefined;

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? globalThis.location.origin,
  getCsrfToken: () => readCsrfToken(),
  onUnauthorized: () => handleUnauthorized(),
});

export function bindApiAuthentication(options: {
  getCsrfToken(): string | undefined;
  onUnauthorized(): void | Promise<void>;
}): void {
  readCsrfToken = () => options.getCsrfToken();
  handleUnauthorized = () => options.onUnauthorized();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toApiFailure(value: unknown): ApiFailure {
  if (value !== null && typeof value === "object" && "error" in value) {
    const error = value.error;
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      "requestId" in error &&
      typeof error.requestId === "string"
    ) {
      return {
        code: error.code,
        message: "",
        details: "details" in error && isRecord(error.details) ? error.details : {},
        requestId: error.requestId,
      };
    }
  }
  return {
    code: "NETWORK_ERROR",
    message: "",
    details: {},
    requestId: "",
  };
}

export type RequestFailure = ApiFailure;
