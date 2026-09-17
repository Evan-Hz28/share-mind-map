import { fileURLToPath } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@share-mind-map/api-client": fileURLToPath(
        new URL("../../packages/api-client/src/index.ts", import.meta.url),
      ),
      "@share-mind-map/document-model": fileURLToPath(
        new URL("../../packages/document-model/src/index.ts", import.meta.url),
      ),
    },
  },
});
