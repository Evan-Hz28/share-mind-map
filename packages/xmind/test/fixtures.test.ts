import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkXMindFixtures,
  generateXMindFixtures,
} from "../../../scripts/generate-xmind-fixtures.js";
import { fixtureRoot, readFixtureManifest, sha256File } from "./helpers.js";

const expectedFiles = [
  "corrupt.xmind",
  "current-json.xmind",
  "duplicate-path.xmind",
  "encrypted.xmind",
  "legacy-xml.xmind",
  "multi-sheet.xmind",
  "nodes-20000.xmind",
  "nodes-5000.xmind",
  "path-traversal.xmind",
  "unknown-extension.xmind",
  "with-png.xmind",
  "zip-bomb.xmind",
];

describe("synthetic XMind fixtures", () => {
  it("labels every fixture synthetic and verifies its SHA-256", async () => {
    const manifest = await readFixtureManifest();

    expect(manifest.generatorVersion).toBe(1);
    expect(manifest.fixtures.map(({ file }) => file)).toEqual(expectedFiles);
    for (const fixture of manifest.fixtures) {
      expect(fixture.provenance).toBe("synthetic");
      expect(await sha256File(join(fixtureRoot, fixture.file))).toBe(fixture.sha256);
    }
  });

  it("regenerates byte-identically inside only the selected directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "xmind-fixtures-test-"));
    const output = join(parent, "fixtures");

    try {
      await generateXMindFixtures(output);
      expect(await readdir(parent)).toEqual(["fixtures"]);
      await expect(checkXMindFixtures(fixtureRoot)).resolves.toBeUndefined();
      await expect(checkXMindFixtures(output)).resolves.toBeUndefined();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
