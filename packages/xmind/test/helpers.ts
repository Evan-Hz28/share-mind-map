import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectXMindFile, type XMindInspection } from "../src/index.js";

export interface FixtureExpectation {
  status: "accepted" | "rejected";
  nodeCount?: number;
  errorCode?: string;
}

export interface FixtureRecord {
  file: string;
  provenance: "synthetic";
  sha256: string;
  expected: FixtureExpectation;
}

export interface FixtureManifest {
  generatorVersion: 1;
  fixtures: FixtureRecord[];
}

export const fixtureRoot = fileURLToPath(
  new URL("../../../tests/fixtures/xmind/", import.meta.url),
);

export function fixturePath(file: string): string {
  return join(fixtureRoot, file);
}

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function readFixtureManifest(): Promise<FixtureManifest> {
  const parsed = JSON.parse(await readFile(join(fixtureRoot, "manifest.json"), "utf8")) as unknown;
  return parsed as FixtureManifest;
}

export async function inspectFixture(file: string): Promise<XMindInspection> {
  return inspectXMindFile(fixturePath(file));
}
