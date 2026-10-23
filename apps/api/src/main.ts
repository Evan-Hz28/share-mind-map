import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { RequestMethod, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  json,
  urlencoded,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import { AppModule } from "./app.module.js";
import type { HealthChecks } from "./health/health.service.js";
import type { MailProvider } from "./mail/mail-provider.js";
import { parseAppConfig, type AppConfig } from "./platform/config/app-config.js";
import {
  ApiErrorFilter,
  isPayloadTooLargeError,
  sendErrorResponse,
} from "./platform/errors/error.filter.js";
import { getRequestId, requestIdMiddleware } from "./platform/http/request-id.middleware.js";
import { createValidationPipe } from "./platform/http/validation.js";
import { createPlatformLogger, type PlatformLogger } from "./platform/logging/logger.js";

/**
 * Nest 默认沿用 body-parser 的 100 KB 上限,而完整快照 JSON 会随节点数增长
 * (实测 458 个节点约 176 KB),保存请求会直接 413。上限按 2 万节点的模型约束留足余量。
 */
const REQUEST_BODY_LIMIT = "20mb";

export interface CreateAppOptions {
  config?: AppConfig;
  healthChecks?: HealthChecks;
  mailProvider?: MailProvider;
  logger?: PlatformLogger;
  module?: Type<unknown>;
}

export async function createApp(options: CreateAppOptions = {}) {
  const config =
    options.config ?? (options.module === undefined ? parseAppConfig(process.env) : undefined);
  const rootModule =
    options.module ??
    AppModule.register({
      config: config as AppConfig,
      ...(options.healthChecks === undefined ? {} : { healthChecks: options.healthChecks }),
      ...(options.mailProvider === undefined ? {} : { mailProvider: options.mailProvider }),
    });
  const logger =
    options.logger ??
    createPlatformLogger({
      environment: config?.environment ?? "test",
      level: config?.logLevel ?? "silent",
    });
  const app = await NestFactory.create(rootModule, {
    logger: false,
    abortOnError: false,
    bodyParser: false,
  });
  // 请求 ID 先于解析器生成,解析失败时响应里也能带上。
  app.use(requestIdMiddleware);
  // 关掉 Nest 内置的 100 KB 解析器,换成显式上限,快照保存才不会在网关前被截断。
  app.use(json({ limit: REQUEST_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT }));
  // 解析器在 Nest 路由之前抛错,全局异常过滤器看不到,这里单独兜底。
  app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
    if (!isPayloadTooLargeError(error)) {
      next(error);
      return;
    }
    sendErrorResponse(response, getRequestId(request), "REQUEST_TOO_LARGE");
  });
  if (config !== undefined) {
    const expressApp = app.getHttpAdapter().getInstance() as Express;
    expressApp.set("trust proxy", config.trustProxyCount);
  }
  app.useLogger(logger);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ApiErrorFilter(logger));
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health/live", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
    ],
  });
  if (config !== undefined) {
    app.enableCors({ origin: config.webOrigin.origin, credentials: true });
  }
  await app.init();
  return app;
}

async function bootstrap(): Promise<void> {
  const config = parseAppConfig(process.env);
  const app = await createApp({ config });
  await app.listen(config.port, config.host);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  void bootstrap();
}
