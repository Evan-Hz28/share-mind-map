import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "../src/index.js";

describe("stable list cursors", () => {
  it("round trips the sort value and unique id", () => {
    const value = {
      sortValue: "2026-09-18T08:00:00.000Z",
      id: "0198e8a1-0000-7000-8000-000000000001",
    };
    expect(decodeCursor(encodeCursor(value))).toEqual(value);
  });

  it("rejects malformed or incomplete cursors", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow("Invalid cursor");
    expect(() =>
      decodeCursor(Buffer.from(JSON.stringify({ sortValue: "x" })).toString("base64url")),
    ).toThrow("Invalid cursor");
  });
});
