import { describe, expect, it } from "vitest";

import { clipTail, OUTPUT_LIMIT } from "../src/api-test/output.js";

function lines(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `FAILED testcases/v3_address/test_case_${String(index)}.py::test_case`,
  ).join("\n");
}

describe("clipTail", () => {
  it("does not cut a line in half", () => {
    const text = `残留的半截行${lines(500)}`;
    const clipped = clipTail(text, OUTPUT_LIMIT);

    expect(clipped.length).toBeLessThanOrEqual(OUTPUT_LIMIT);
    expect(clipped.startsWith("FAILED testcases/")).toBe(true);
  });

  it("keeps short output untouched", () => {
    const text = "ERROR: found no collectors for testcases/a.py::test_a";

    expect(clipTail(text, OUTPUT_LIMIT)).toBe(text);
  });

  it("keeps the tail when there is no newline to cut at", () => {
    const text = "x".repeat(OUTPUT_LIMIT * 2);

    expect(clipTail(text, OUTPUT_LIMIT)).toBe("x".repeat(OUTPUT_LIMIT));
  });
});
