import { errorCatalog, type ApiErrorCode } from "./error-catalog.js";

export type ErrorDetails = Record<string, boolean | number | string | null>;

export class ApiError extends Error {
  public readonly status: number;

  public constructor(
    public readonly code: ApiErrorCode,
    public readonly details: ErrorDetails = {},
  ) {
    super(errorCatalog[code].message);
    this.name = "ApiError";
    this.status = errorCatalog[code].status;
  }
}
