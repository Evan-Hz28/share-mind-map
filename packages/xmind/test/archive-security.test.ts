import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ZipFile } from "yazl";
import { describe, expect, it } from "vitest";

import { inspectXMindFile } from "../src/index.js";
import { fixturePath, inspectFixture } from "./helpers.js";

async function createZip(entries: Array<{ path: string; data: Buffer }>): Promise<Buffer> {
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });
  for (const entry of entries) zip.addBuffer(entry.data, entry.path, { compress: false });
  zip.end();
  return complete;
}

describe("XMind archive security", () => {
  it.each([
    ["corrupt.xmind", "FILE_DAMAGED"],
    ["path-traversal.xmind", "ARCHIVE_PATH_UNSAFE"],
    ["duplicate-path.xmind", "ARCHIVE_DUPLICATE_PATH"],
    ["zip-bomb.xmind", "ARCHIVE_LIMIT_EXCEEDED"],
    ["encrypted.xmind", "ARCHIVE_ENCRYPTED"],
  ])("rejects %s with stable code", async (file, code) => {
    await expect(inspectFixture(file)).rejects.toMatchObject({ code });
  });

  it("enforces the compressed input limit before opening the archive", async () => {
    await expect(
      inspectXMindFile(fixturePath("current-json.xmind"), { maxCompressedBytes: 8 }),
    ).rejects.toMatchObject({ code: "ARCHIVE_LIMIT_EXCEEDED" });
  });

  it("prefers current JSON when an archive also contains legacy XML", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xmind-dual-root-test-"));
    const path = join(directory, "dual-root.xmind");
    const json = Buffer.from(
      JSON.stringify([{ id: "json-sheet", rootTopic: { id: "json-root", title: "JSON root" } }]),
      "utf8",
    );
    const xml = Buffer.from(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">',
        '  <sheet id="xml-sheet"><title>XML sheet</title>',
        '    <topic id="xml-root"><title>XML root</title></topic>',
        "  </sheet>",
        "</xmap-content>",
      ].join("\n"),
      "utf8",
    );

    try {
      await writeFile(
        path,
        await createZip([
          { path: "content.json", data: json },
          { path: "content.xml", data: xml },
        ]),
      );

      const inspection = await inspectXMindFile(path);

      expect(inspection.format).toBe("content-json");
      expect(inspection.sheets[0]?.title).toBe("");
      expect(inspection.sheets[0]?.nodes["json-root"]?.title).toBe("JSON root");
      expect(inspection.compatibility).toContainEqual({
        featurePath: "content.xml",
        disposition: "normalized",
        message: "Both current JSON and legacy XML roots were found; current JSON was selected.",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("falls back to legacy XML when the current JSON root is invalid", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xmind-dual-root-fallback-test-"));
    const path = join(directory, "dual-root-fallback.xmind");
    const xml = Buffer.from(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">',
        '  <sheet id="xml-sheet"><title>XML sheet</title>',
        '    <topic id="xml-root"><title>XML root</title></topic>',
        "  </sheet>",
        "</xmap-content>",
      ].join("\n"),
      "utf8",
    );

    try {
      await writeFile(
        path,
        await createZip([
          { path: "content.json", data: Buffer.from("not-json", "utf8") },
          { path: "content.xml", data: xml },
        ]),
      );

      const inspection = await inspectXMindFile(path);

      expect(inspection.format).toBe("content-xml");
      expect(inspection.sheets[0]?.title).toBe("XML sheet");
      expect(inspection.sheets[0]?.nodes["xml-root"]?.title).toBe("XML root");
      expect(inspection.compatibility).toContainEqual({
        featurePath: "content.json",
        disposition: "normalized",
        message: "Current JSON was invalid; legacy XML was selected.",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
