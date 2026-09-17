import { describe, expect, it } from "vitest";

import { inspectXMindFile } from "../src/index.js";
import { fixturePath, inspectFixture } from "./helpers.js";

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
});
