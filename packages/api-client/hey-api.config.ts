import { defineConfig, type UserConfig } from "@hey-api/openapi-ts";
import { fileURLToPath } from "node:url";

export const defaultInputPath = fileURLToPath(new URL("./openapi.json", import.meta.url));
export const defaultOutputPath = fileURLToPath(new URL("./src/generated", import.meta.url));

export function createHeyApiConfig(
  input = defaultInputPath,
  output = defaultOutputPath,
): UserConfig {
  return {
    input,
    output: {
      path: output,
      clean: true,
      header: ({ defaultValue }) => ["// @ts-nocheck", ...defaultValue],
      module: { extension: ".js" },
      postProcess: [],
      source: false,
      tsConfigPath: fileURLToPath(new URL("./tsconfig.json", import.meta.url)),
    },
    plugins: [
      "@hey-api/typescript",
      {
        name: "@hey-api/sdk",
        auth: false,
        client: "@hey-api/client-fetch",
        operations: "flat",
        responseStyle: "fields",
      },
      "@hey-api/client-fetch",
    ],
  };
}

export default defineConfig(createHeyApiConfig());
