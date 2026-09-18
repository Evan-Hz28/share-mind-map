import { describe, expect, it } from "vitest";

import { EntityNameValidationError, normalizeEntityName } from "../src/index.js";

describe("normalizeEntityName", () => {
  it("normalizes Unicode, surrounding whitespace, repeated whitespace and case", () => {
    expect(normalizeEntityName("  E\u0301xample\t Name  ", 50)).toEqual({
      displayName: "Éxample Name",
      normalizedName: "éxample name",
    });
  });

  it("rejects blank and overlong names with stable reasons", () => {
    expect(() => normalizeEntityName(" \t ", 50)).toThrow(
      expect.objectContaining({ reason: "required" }),
    );
    expect(() => normalizeEntityName("12345", 4)).toThrow(
      expect.objectContaining({ reason: "too_long" }),
    );
    expect(new EntityNameValidationError("required", "x")).toBeInstanceOf(Error);
  });
});
