import type { LoggerService } from "@nestjs/common";
import pino, { type DestinationStream, type Logger } from "pino";

import type { AppEnvironment, LogLevel } from "../config/app-config.js";
import { redact } from "./redaction.js";

export interface PlatformLogger extends LoggerService {
  fatal(message: unknown, ...optionalParameters: unknown[]): void;
}

export interface StructuredLogEvent {
  requestId?: string;
  userId?: string;
  targetId?: string;
  operation: string;
  durationMs?: number;
  result: "success" | "failure" | "denied";
  errorCode?: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  environment: AppEnvironment;
  level: LogLevel;
  destination?: DestinationStream;
}

const exactRedactionPaths = [
  "password",
  "currentPassword",
  "newPassword",
  "temporaryPassword",
  "passwordHash",
  "authorization",
  "cookie",
  "['set-cookie']",
  "['x-csrf-token']",
  "headers.authorization",
  "headers.cookie",
  "headers['set-cookie']",
  "headers['x-csrf-token']",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-csrf-token']",
  "sessionId",
  "sessionToken",
  "sessionSecret",
  "snapshot",
  "document",
  "image",
] as const;

export class AppLogger implements PlatformLogger {
  private readonly logger: Logger;

  public constructor(options: LoggerOptions) {
    this.logger = pino(
      {
        level: options.level,
        base: { service: "api", environment: options.environment },
        timestamp: pino.stdTimeFunctions.isoTime,
        redact: { paths: [...exactRedactionPaths], censor: "[REDACTED]" },
      },
      options.destination,
    );
  }

  public event(event: StructuredLogEvent): void {
    this.logger.info(redact(event));
  }

  public log(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.info(redact({ message, optionalParameters }));
  }

  public error(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.error(redact({ message, optionalParameters }));
  }

  public warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.warn(redact({ message, optionalParameters }));
  }

  public debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.debug(redact({ message, optionalParameters }));
  }

  public verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.trace(redact({ message, optionalParameters }));
  }

  public fatal(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.fatal(redact({ message, optionalParameters }));
  }
}

export function createPlatformLogger(options: LoggerOptions): AppLogger {
  return new AppLogger(options);
}
