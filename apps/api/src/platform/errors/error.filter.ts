import { BadRequestException, Catch, NotFoundException } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";

import { getRequestId } from "../http/request-id.middleware.js";
import type { PlatformLogger } from "../logging/logger.js";
import { ApiError, type ErrorDetails } from "./api-error.js";
import { errorCatalog, type ApiErrorCode } from "./error-catalog.js";

/** body-parser 超限错误发生在 Nest 路由之前,只能由 Express 错误中间件识别。 */
export function isPayloadTooLargeError(exception: unknown): boolean {
  return (
    typeof exception === "object" &&
    exception !== null &&
    (exception as { type?: unknown }).type === "entity.too.large"
  );
}

/** 统一的错误响应体,路由异常和解析器异常都走这里。 */
export function sendErrorResponse(
  response: Response,
  requestId: string,
  code: ApiErrorCode,
  details: ErrorDetails = {},
): void {
  response.status(errorCatalog[code].status).json({
    error: {
      code,
      message: errorCatalog[code].message,
      details,
      requestId,
    },
  });
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  public constructor(private readonly logger: PlatformLogger) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = getRequestId(request);
    const error =
      exception instanceof ApiError
        ? exception
        : isPayloadTooLargeError(exception)
          ? new ApiError("REQUEST_TOO_LARGE")
          : exception instanceof NotFoundException
            ? new ApiError("NOT_FOUND")
            : exception instanceof BadRequestException
              ? new ApiError("INVALID_INPUT")
              : new ApiError("INTERNAL_ERROR");

    if (
      !(exception instanceof ApiError) &&
      !isPayloadTooLargeError(exception) &&
      !(exception instanceof BadRequestException) &&
      !(exception instanceof NotFoundException)
    ) {
      const source = exception instanceof Error ? exception : new Error("Unknown failure");
      const stackFrames = source.stack?.split("\n").slice(1).join("\n");
      this.logger.error({
        requestId,
        operation: `${request.method} ${request.path}`,
        result: "failure",
        errorCode: error.code,
        errorName: source.name,
        stack: stackFrames,
      });
    }

    sendErrorResponse(response, requestId, error.code, error.details);
  }
}
