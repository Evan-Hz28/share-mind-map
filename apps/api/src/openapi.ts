import { SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { DocumentBuilder } from "@nestjs/swagger";
import type { INestApplication } from "@nestjs/common";

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setTitle("Share Mind Map API")
    .setVersion("1.0.0")
    .addServer("/api/v1")
    .build();
  const document = SwaggerModule.createDocument(app, configuration);
  document.components ??= {};
  document.components.securitySchemes = {
    ...document.components.securitySchemes,
    sessionCookie: { type: "apiKey", in: "cookie", name: "smm_session" },
    csrfToken: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
    requestId: { type: "apiKey", in: "header", name: "X-Request-ID" },
  };
  document.components.schemas = {
    ...document.components.schemas,
    ApiErrorEnvelope: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message", "details", "requestId"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            details: { type: "object", additionalProperties: true },
            requestId: { type: "string", minLength: 16, maxLength: 64 },
          },
        },
      },
    },
  };
  for (const path of ["/health/live", "/health/ready"]) {
    const operation = document.paths[path]?.get;
    if (operation !== undefined) operation.servers = [{ url: "/" }];
  }
  return document;
}
