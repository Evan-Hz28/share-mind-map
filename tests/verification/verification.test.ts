import { describe, expect, it } from "vitest";

import {
  completionVerdict,
  findMissingEvidence,
  renderReport,
  requiredEvidence,
} from "../../scripts/verify-phase-0-1.mjs";

describe("phase 0-1 verification evidence", () => {
  it("reports every required artifact that is absent", async () => {
    const present = new Set(["schema.json", "openapi.json"]);

    await expect(
      findMissingEvidence(["schema.json", "openapi.json", "task-report.md"], async (path) =>
        Promise.resolve(present.has(path)),
      ),
    ).resolves.toEqual(["task-report.md"]);
  });

  it("refuses a pass verdict when evidence is missing or a probe failed", () => {
    expect(completionVerdict([], [])).toBe("PASS");
    expect(completionVerdict(["missing"], [])).toBe("INCOMPLETE");
    expect(completionVerdict([], ["failed command"])).toBe("INCOMPLETE");
  });

  it("requires the Task 12 completion report", async () => {
    const taskReport = ".superpowers/sdd/2026-09-16-phase-0-1/task-12-report.md";

    await expect(
      findMissingEvidence(requiredEvidence, async (path) => Promise.resolve(path !== taskReport)),
    ).resolves.toEqual([taskReport]);
  });

  it("renders exactly one trailing newline", () => {
    const report = renderReport({
      generatedAt: "2026-09-17T00:00:00.000Z",
      verdict: "PASS",
      missingEvidence: [],
      failedProbes: [],
      versions: {},
      runtime: [],
      results: [],
    });

    expect(report.endsWith("\n")).toBe(true);
    expect(report.endsWith("\n\n")).toBe(false);
  });
});
