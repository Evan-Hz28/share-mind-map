import "reflect-metadata";

import type { Server } from "node:http";

import { Body, Controller, Get, Module, Post } from "@nestjs/common";
import { IsString } from "class-validator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/main.js";
import { ApiError } from "../src/platform/errors/api-error.js";
import type { PlatformLogger } from "../src/platform/logging/logger.js";

class InputDto {
  @IsString()
  public name!: string;
}

@Controller()
class TestController {
  @Get("test-error")
  public error(): never {
    throw new ApiError("INVALID_INPUT", { field: "name" });
  }

  @Get("unexpected")
  public unexpected(): never {
    throw new Error("database password: should-never-reach-the-client");
  }

  @Post("validated")
  public validated(@Body() input: InputDto): InputDto {
    return input;
  }
}

@Module({ controllers: [TestController] })
// Nest test modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class TestModule {}

class CapturingLogger implements PlatformLogger {
  public readonly errors: unknown[] = [];

  public log(): void {}
  public warn(): void {}
  public debug(): void {}
  public verbose(): void {}
  public fatal(): void {}
  public error(message: unknown): void {
    this.errors.push(message);
  }
}

describe("API request lifecycle", () => {
  const logger = new CapturingLogger();
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    app = await createApp({ module: TestModule, logger });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the canonical safe error envelope with the accepted request ID", async () => {
    const requestId = "request-1234567890";
    const response = await request(app.getHttpServer() as Server)
      .get("/api/v1/test-error")
      .set("x-request-id", requestId);

    expect(response.status).toBe(400);
    expect(response.headers["x-request-id"]).toBe(requestId);
    expect(response.body).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "请求参数无效。",
        details: { field: "name" },
        requestId,
      },
    });
  });

  it("generates a UUIDv7 request ID when the supplied value is invalid", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get("/api/v1/test-error")
      .set("x-request-id", "bad");
    const generatedRequestId = response.get("x-request-id");

    expect(generatedRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.body as unknown).toMatchObject({ error: { requestId: generatedRequestId } });
  });

  it("rejects unknown DTO properties", async () => {
    const response = await request(app.getHttpServer() as Server)
      .post("/api/v1/validated")
      .send({ name: "valid", unexpected: true });

    expect(response.status).toBe(400);
    expect(response.body as unknown).toMatchObject({
      error: { code: "INVALID_INPUT", details: {} },
    });
  });

  it("exposes only INTERNAL_ERROR for unexpected failures", async () => {
    const response = await request(app.getHttpServer() as Server).get("/api/v1/unexpected");

    expect(response.status).toBe(500);
    expect(response.text).not.toContain("database password");
    expect(response.body as unknown).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        message: "服务暂时不可用，请稍后重试。",
        details: {},
      },
    });
    expect(logger.errors).toHaveLength(1);
    expect(JSON.stringify(logger.errors)).not.toContain("should-never-reach-the-client");
  });
});
