import { expect, test } from "@playwright/test";

import type { CanvasFunctionalChecks } from "../../apps/web/src/poc/types.js";

const candidates = ["simple-mind-map", "mind-elixir", "jsmind"] as const;

for (const candidate of candidates) {
  test(`${candidate} satisfies the browser PoC contract`, async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.goto(`/poc.html?candidate=${candidate}&nodes=100`);
    await expect.poll(() => page.evaluate(() => window.__CANVAS_POC__?.ready ?? false)).toBe(true);
    const result = await page.evaluate((): Promise<CanvasFunctionalChecks> => {
      const runtime = window.__CANVAS_POC__;
      if (runtime === undefined) throw new Error("Canvas runtime is absent.");
      return runtime.runFunctionalChecks();
    });

    expect(result).toEqual({
      readOnly: true,
      focus: true,
      zoomPan: true,
      collapse: true,
      snapshotReplacement: true,
      stateRestoration: true,
      deterministicExport: true,
      cleanup: true,
    });
    expect(browserErrors).toEqual([]);
  });
}
