import { fileURLToPath } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api": {
        target: process.env.SMM_E2E_API_ORIGIN ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/socket.io": {
        target: process.env.SMM_E2E_API_ORIGIN ?? "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
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
