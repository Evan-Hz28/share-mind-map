import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  outputDir: "./test-results",
  reporter: "line",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command:
      "pnpm --filter @share-mind-map/web exec vite --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/poc.html",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      testMatch: /e2e\/.*\.spec\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:8080",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-chrome",
      testMatch: /e2e\/responsive\.spec\.ts/u,
      use: {
        ...devices["Pixel 5"],
        baseURL: "http://127.0.0.1:8080",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "canvas-chromium",
      testMatch: /canvas\/.*\.spec\.ts/u,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4173" },
    },
  ],
});
