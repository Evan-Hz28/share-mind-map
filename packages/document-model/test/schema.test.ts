import { describe, expect, it } from "vitest";

import { parseCloudDocument } from "../src/index.js";
import { ids, validDocument } from "./helpers.js";

describe("CloudDocumentV1 schema", () => {
  it("accepts one reachable root and preserves sibling order", () => {
    const parsed = parseCloudDocument(validDocument({ childIds: [ids.childB, ids.childA] }));

    expect(parsed.sheets[0]?.nodes[ids.root]?.childIds).toEqual([ids.childB, ids.childA]);
  });

  it("rejects collapsed as shared node data", () => {
    expect(() => parseCloudDocument(validDocument({ nodePatch: { collapsed: true } }))).toThrow(
      expect.objectContaining({ code: "DOCUMENT_SCHEMA_INVALID" }),
    );
  });

  it("requires extension keys to be explicitly namespaced", () => {
    const document = validDocument();
    document.extensions = { raw: true };

    expect(() => parseCloudDocument(document)).toThrow(
      expect.objectContaining({ code: "DOCUMENT_SCHEMA_INVALID" }),
    );
  });
});
