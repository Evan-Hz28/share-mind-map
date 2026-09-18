import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@share-mind-map/document-model": fileURLToPath(
        new URL("../document-model/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    maxWorkers: 1,
  },
});
