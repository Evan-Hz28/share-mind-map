import { countDocumentNodes } from "@share-mind-map/document-model";
import { describe, expect, it } from "vitest";

import { convertXMindToCloudDocument, type XMindInspection } from "../src/index.js";
import { inspectFixture } from "./helpers.js";

const identity = {
  documentId: "00000000-0000-7000-8000-000000000001",
  version: 0,
} as const;
const stableChildId = "00000000-0000-7000-8000-000000000011";

function firstSheet(inspection: XMindInspection) {
  const sheet = inspection.sheets[0];
  if (sheet === undefined) throw new Error("Expected an inspected sheet.");
  return sheet;
}

describe("XMind conversion", () => {
  it("preserves current JSON hierarchy, content, styles, and relationships", async () => {
    const inspection = await inspectFixture("current-json.xmind");
    const document = convertXMindToCloudDocument(inspection, identity);
    const sheet = document.sheets[0];
    if (sheet === undefined) throw new Error("Expected a converted sheet.");
    const root = sheet.nodes[sheet.rootNodeId];
    if (root === undefined) throw new Error("Expected a converted root.");

    expect(inspection.format).toBe("content-json");
    expect(document.documentId).toBe(identity.documentId);
    expect(root.title).toBe("Current root");
    expect(root.priority).toBe("P0");
    expect(root.notes).toEqual({ format: "plain", text: "Root notes" });
    expect(root.labels).toEqual(["alpha", "beta"]);
    expect(root.icons).toEqual(["star-blue"]);
    expect(root.style).toEqual({
      backgroundColor: "#DDEEFF",
      fontFamily: "Inter",
      fontSize: 18,
      fontWeight: 700,
      textColor: "#112233",
    });
    expect(root.childIds.map((id) => sheet.nodes[id]?.title)).toEqual([
      "Stable child",
      "Second child",
    ]);
    expect(sheet.nodes[stableChildId]?.id).toBe(stableChildId);
    expect(sheet.relationships).toHaveLength(1);
    expect(sheet.relationships[0]?.title).toBe("Depends on");
  });

  it("derives stable IDs deterministically for non-UUID source identities", async () => {
    const inspection = await inspectFixture("current-json.xmind");

    expect(convertXMindToCloudDocument(inspection, identity)).toEqual(
      convertXMindToCloudDocument(inspection, identity),
    );
  });

  it("parses legacy XML and multiple sheets through the same model", async () => {
    const legacy = convertXMindToCloudDocument(await inspectFixture("legacy-xml.xmind"), identity);
    const multi = convertXMindToCloudDocument(await inspectFixture("multi-sheet.xmind"), identity);

    const legacySheet = legacy.sheets[0];
    if (legacySheet === undefined) throw new Error("Expected a legacy sheet.");
    expect(legacySheet.nodes[legacySheet.rootNodeId]?.title).toBe("Legacy root");
    expect(countDocumentNodes(legacy)).toBe(2);
    expect(multi.sheets.map(({ title }) => title)).toEqual(["First", "Second"]);
  });

  it("retains a safe PNG reference and tested unknown XMind data", async () => {
    const imageInspection = await inspectFixture("with-png.xmind");
    const imageDocument = convertXMindToCloudDocument(imageInspection, identity);
    const imageSheet = imageDocument.sheets[0];
    const imageRoot = imageSheet?.nodes[imageSheet.rootNodeId];
    expect(imageInspection.assets["resources/pixel.png"]?.mediaType).toBe("image/png");
    expect(imageRoot?.imageAssetId).toMatch(/^[0-9a-f-]{36}$/);

    const unknownInspection = await inspectFixture("unknown-extension.xmind");
    const unknownDocument = convertXMindToCloudDocument(unknownInspection, identity);
    const unknownSheet = unknownDocument.sheets[0];
    const unknownRoot = unknownSheet?.nodes[unknownSheet.rootNodeId];
    expect(unknownRoot?.extensions["xmind.unknown"]).toEqual({
      futureFlag: "synthetic-value",
    });
    expect(unknownInspection.compatibility).toContainEqual(
      expect.objectContaining({
        disposition: "preserved",
        featurePath: "sheets[0].rootTopic.futureFlag",
      }),
    );
  });

  it.each([
    ["nodes-5000.xmind", 5_000],
    ["nodes-20000.xmind", 20_000],
  ])("converts %s with exactly %s nodes", async (fixture, expectedCount) => {
    const document = convertXMindToCloudDocument(await inspectFixture(fixture), identity);
    expect(countDocumentNodes(document)).toBe(expectedCount);
  });

  it("rejects a 20,001st node before producing a cloud document", async () => {
    const inspection = structuredClone(await inspectFixture("nodes-20000.xmind"));
    const sheet = firstSheet(inspection);
    const root = sheet.nodes[sheet.rootSourceId];
    if (root === undefined) throw new Error("Expected an inspected root.");
    const extraId = "synthetic-node-20001";
    root.childSourceIds.push(extraId);
    sheet.nodes[extraId] = {
      sourceId: extraId,
      parentSourceId: root.sourceId,
      childSourceIds: [],
      title: "Overflow",
      priority: null,
      notes: null,
      labels: [],
      icons: [],
      style: {},
      imagePath: null,
      extensions: {},
    };

    expect(() => convertXMindToCloudDocument(inspection, identity)).toThrow(
      expect.objectContaining({ code: "DOCUMENT_NODE_LIMIT_REACHED" }),
    );
  });

  it("rejects broken structure and unsafe image paths", async () => {
    const missingRoot = structuredClone(await inspectFixture("current-json.xmind"));
    firstSheet(missingRoot).rootSourceId = "missing";
    expect(() => convertXMindToCloudDocument(missingRoot, identity)).toThrow(
      expect.objectContaining({ code: "XMIND_STRUCTURE_INVALID" }),
    );

    const brokenParent = structuredClone(await inspectFixture("current-json.xmind"));
    const brokenNode = firstSheet(brokenParent).nodes[stableChildId];
    if (brokenNode === undefined) throw new Error("Expected the stable child.");
    brokenNode.parentSourceId = "missing";
    expect(() => convertXMindToCloudDocument(brokenParent, identity)).toThrow(
      expect.objectContaining({ code: "XMIND_STRUCTURE_INVALID" }),
    );

    const unsafeImage = structuredClone(await inspectFixture("with-png.xmind"));
    const sheet = firstSheet(unsafeImage);
    const imageNode = sheet.nodes[sheet.rootSourceId];
    if (imageNode === undefined) throw new Error("Expected an image root.");
    imageNode.imagePath = "../secret.png";
    expect(() => convertXMindToCloudDocument(unsafeImage, identity)).toThrow(
      expect.objectContaining({ code: "IMAGE_PATH_UNSAFE" }),
    );
  });
});
