import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fromBufferPromise } from "yauzl";
import { describe, expect, it } from "vitest";

import {
  convertXMindToCloudDocument,
  exportCloudDocumentToXMind,
  inspectXMindFile,
} from "../src/index.js";
import { inspectFixture } from "./helpers.js";

const identity = {
  documentId: "00000000-0000-7000-8000-000000000001",
  version: 1,
} as const;

async function readZipEntries(bytes: Buffer): Promise<Map<string, Buffer>> {
  const zip = await fromBufferPromise(bytes);
  const entries = new Map<string, Buffer>();
  try {
    for await (const entry of zip.eachEntry()) {
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
      entries.set(entry.fileName, Buffer.concat(chunks));
    }
    return entries;
  } finally {
    if (zip.isOpen) zip.close();
  }
}

describe("XMind export", () => {
  it("round-trips a CloudDocumentV1 through a deterministic XMind archive", async () => {
    const source = convertXMindToCloudDocument(
      await inspectFixture("current-json.xmind"),
      identity,
    );

    const first = await exportCloudDocumentToXMind(source);
    const second = await exportCloudDocumentToXMind(source);

    expect(first.compatibility.status).toBe("full");
    expect(first.bytes.equals(second.bytes)).toBe(true);
    const entries = await readZipEntries(first.bytes);
    expect([...entries.keys()].sort()).toEqual(["content.json", "manifest.json", "metadata.json"]);
    const content = JSON.parse(entries.get("content.json")?.toString("utf8") ?? "null") as [
      Record<string, unknown>,
    ];
    expect(content[0]).toMatchObject({
      class: "sheet",
      theme: {},
      arrangeableLayerOrder: [expect.any(String)],
      zones: [],
    });
    expect(content[0]?.rootTopic).toMatchObject({ class: "topic" });
    expect(JSON.parse(entries.get("metadata.json")?.toString("utf8") ?? "null")).toEqual({
      dataStructureVersion: "3",
      creator: { name: "Kitar", version: "1.0.0" },
      layoutEngineVersion: "5",
    });
    expect(JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "null")).toEqual({
      "file-entries": {
        "content.json": {},
        "metadata.json": {},
      },
    });
    const directory = await mkdtemp(join(tmpdir(), "xmind-export-test-"));
    const outputPath = join(directory, "round-trip.xmind");
    try {
      await writeFile(outputPath, first.bytes);
      const roundTripInspection = await inspectXMindFile(outputPath, {
        maxCompressedBytes: first.bytes.length + 1,
      });
      const roundTrip = convertXMindToCloudDocument(roundTripInspection, identity);
      expect(roundTrip.sheets.map(({ title }) => title)).toEqual(
        source.sheets.map(({ title }) => title),
      );
      const roundTripSheet = roundTrip.sheets[0];
      expect(roundTripSheet?.nodes[roundTripSheet.rootNodeId]?.title).toBe("Current root");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lists exported image assets in the manifest", async () => {
    const source = convertXMindToCloudDocument(await inspectFixture("with-png.xmind"), identity);
    const sheet = source.sheets[0];
    if (sheet === undefined) throw new Error("Expected an exported sheet.");
    const root = sheet.nodes[sheet.rootNodeId];
    if (root?.imageAssetId === null || root === undefined)
      throw new Error("Expected an image asset reference.");
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    const result = await exportCloudDocumentToXMind(source, {
      assets: [
        {
          assetId: root.imageAssetId,
          path: "resources/pixel.png",
          mediaType: "image/png",
          bytes: image,
        },
      ],
    });
    const entries = await readZipEntries(result.bytes);
    const manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "null") as {
      "file-entries": Record<string, unknown>;
    };

    expect(manifest["file-entries"]).toHaveProperty("resources/pixel.png");
    expect(entries.get("resources/pixel.png")).toEqual(image);
  });
});
