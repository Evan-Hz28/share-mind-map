/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";

import { DocumentModelError } from "../src/errors.js";
import {
  cloneCloudDocument,
  normalizeCloudDocumentVersion,
  validateCloudDocumentSnapshot,
} from "../src/snapshot.js";
import { cycleDocument, validDocument } from "./helpers.js";

describe("CloudDocument snapshot utilities", () => {
  it("clones nested document data without sharing references", () => {
    const original = validDocument();
    const clone = cloneCloudDocument(original);

    clone.sheets[0]!.nodes[clone.sheets[0]!.rootNodeId]!.title = "Changed";
    clone.sheets[0]!.nodes[clone.sheets[0]!.rootNodeId]!.childIds.push("new-child");

    expect(original.sheets[0]!.nodes[original.sheets[0]!.rootNodeId]!.title).toBe("Root");
    expect(original.sheets[0]!.nodes[original.sheets[0]!.rootNodeId]!.childIds).not.toContain(
      "new-child",
    );
  });

  it("normalizes only the document version", () => {
    const original = validDocument();
    const normalized = normalizeCloudDocumentVersion(original, 42);

    expect(normalized.version).toBe(42);
    expect(normalized.documentId).toBe(original.documentId);
    expect(normalized.sheets).toEqual(original.sheets);
    expect(original.version).toBe(0);
  });

  it("rejects a snapshot with a cycle instead of repairing it", () => {
    expect(() => validateCloudDocumentSnapshot(cycleDocument())).toThrow(DocumentModelError);
    expect(() => validateCloudDocumentSnapshot(cycleDocument())).toThrow("participates in a cycle");
  });

  it("returns a validated clone for a valid standard snapshot", () => {
    const original = validDocument();
    const validated = validateCloudDocumentSnapshot(original);

    expect(validated).toEqual(original);
    expect(validated).not.toBe(original);
  });
});
