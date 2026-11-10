import { describe, expect, it } from "vitest";

import { trimCutFragment } from "../src/api-tests/error-output.js";

// worker 只存尾部 8 KB，这里补到上限以上，模拟被截断的报告。
function clipped(firstLine: string): string {
  const body = "FAILED testcases/v3_address/test_address_cors.py::TestAddressCORS::test_cors\n";
  return firstLine + "\n" + body.repeat(120);
}

describe("trimCutFragment", () => {
  it("drops a half line left by tail clipping", () => {
    const message = clipped("ght");

    expect(message.length).toBeGreaterThan(8 * 1024);
    expect(trimCutFragment(message).startsWith("FAILED testcases/")).toBe(true);
  });

  it("keeps short pytest lines that are not fragments", () => {
    for (const first of ["ERROR", "E", "=", "FF"]) {
      expect(trimCutFragment(clipped(first)).startsWith(`${first}\n`)).toBe(true);
    }
  });

  it("leaves short messages alone", () => {
    const message = "ght\nFAILED testcases/a.py::test_a";

    expect(trimCutFragment(message)).toBe(message);
  });
});
