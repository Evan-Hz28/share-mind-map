import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createClient } from "@hey-api/openapi-ts";

import { defaultOpenApiPath, emitOpenApi } from "../apps/api/scripts/emit-openapi.js";
import { createHeyApiConfig, defaultOutputPath } from "../packages/api-client/hey-api.config.js";

export interface GenerateApiClientOptions {
  openApiPath?: string;
  outputPath?: string;
}

export async function generateApiClient(options: GenerateApiClientOptions = {}): Promise<void> {
  const openApiPath = options.openApiPath ?? defaultOpenApiPath;
  const outputPath = options.outputPath ?? defaultOutputPath;
  await emitOpenApi(openApiPath);
  await createClient(createHeyApiConfig(openApiPath, outputPath));
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await generateApiClient();
  process.stdout.write("Generated deterministic OpenAPI and TypeScript API client.\n");
}
