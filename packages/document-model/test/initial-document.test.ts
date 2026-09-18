import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createInitialCloudDocument,
  countDocumentNodes,
  parseCloudDocument,
} from "../src/index.js";

describe("createInitialCloudDocument", () => {
  it("creates a legal version 1 single-root document", () => {
    const document = createInitialCloudDocument(randomUUID());
    expect(parseCloudDocument(document)).toEqual(document);
    expect(document.version).toBe(1);
    expect(document.sheets).toHaveLength(1);
    expect(countDocumentNodes(document)).toBe(1);
    expect(Object.values(document.sheets[0]?.nodes ?? {})[0]?.parentId).toBeNull();
  });
});
