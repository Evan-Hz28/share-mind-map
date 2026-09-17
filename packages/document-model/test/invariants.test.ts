import { describe, expect, it } from "vitest";

import {
  countDocumentNodes,
  parseCloudDocument,
  validateDocumentInvariants,
} from "../src/index.js";
import {
  brokenRelationshipDocument,
  cycleDocument,
  generatedChainDocument,
  generatedDocument,
  getNode,
  getSheet,
  ids,
  orphanDocument,
  validDocument,
} from "./helpers.js";

function issueCodes(input: ReturnType<typeof validDocument>) {
  return validateDocumentInvariants(input).map((issue) => issue.code);
}

describe("CloudDocumentV1 graph invariants", () => {
  it("detects a cycle even when it is disconnected from the root", () => {
    expect(issueCodes(cycleDocument())).toContain("DOCUMENT_CYCLE");
  });

  it("detects a node that is not reachable from the root", () => {
    expect(issueCodes(orphanDocument())).toContain("DOCUMENT_NODE_UNREACHABLE");
  });

  it("rejects a relationship whose target is missing", () => {
    expect(issueCodes(brokenRelationshipDocument())).toContain("RELATIONSHIP_TARGET_MISSING");
  });

  it("rejects more than 20,000 nodes", () => {
    const document = generatedDocument(20_001);
    expect(countDocumentNodes(document)).toBe(20_001);
    expect(() => parseCloudDocument(document)).toThrow(
      expect.objectContaining({ code: "DOCUMENT_NODE_LIMIT_REACHED" }),
    );
  });

  it("validates a 20,000-level tree without overflowing the call stack", () => {
    const document = generatedChainDocument(20_000);

    expect(() => parseCloudDocument(document)).not.toThrow();
  });

  it("requires node IDs to be unique across sheets", () => {
    const document = validDocument();
    const firstSheet = getSheet(document);
    document.sheets.push({
      ...structuredClone(firstSheet),
      id: ids.secondSheet,
      title: "Second sheet",
    });

    expect(issueCodes(document)).toContain("DOCUMENT_NODE_ID_DUPLICATE");
  });

  it("caps diagnostics at 100 issues", () => {
    const document = generatedDocument(150);
    const sheet = getSheet(document);
    for (const childId of getNode(sheet, ids.root).childIds) {
      getNode(sheet, childId).parentId = ids.missing;
    }

    expect(validateDocumentInvariants(document)).toHaveLength(100);
  });
});
