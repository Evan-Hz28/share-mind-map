import { BadRequestException, Catch, NotFoundException } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";

import { getRequestId } from "../http/request-id.middleware.js";
import type { PlatformLogger } from "../logging/logger.js";
import { ApiError } from "./api-error.js";
import { errorCatalog } from "./error-catalog.js";

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
        : exception instanceof NotFoundException
          ? new ApiError("NOT_FOUND")
          : exception instanceof BadRequestException
            ? new ApiError("INVALID_INPUT")
            : new ApiError("INTERNAL_ERROR");

    if (
      !(exception instanceof ApiError) &&
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

    response.status(error.status).json({
      error: {
        code: error.code,
        message: errorCatalog[error.code].message,
        details: error.details,
        requestId,
      },
    });
  }
}
