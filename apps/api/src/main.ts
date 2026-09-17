import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { RequestMethod, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Express } from "express";

import { AppModule } from "./app.module.js";
import type { HealthChecks } from "./health/health.service.js";
import type { MailProvider } from "./mail/mail-provider.js";
import { parseAppConfig, type AppConfig } from "./platform/config/app-config.js";
import { ApiErrorFilter } from "./platform/errors/error.filter.js";
import { requestIdMiddleware } from "./platform/http/request-id.middleware.js";
import { createValidationPipe } from "./platform/http/validation.js";
import { createPlatformLogger, type PlatformLogger } from "./platform/logging/logger.js";

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
  const app = await NestFactory.create(rootModule, { logger: false, abortOnError: false });
  if (config !== undefined) {
    const expressApp = app.getHttpAdapter().getInstance() as Express;
    expressApp.set("trust proxy", config.trustProxyCount);
  }
  app.useLogger(logger);
  app.use(requestIdMiddleware);
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
