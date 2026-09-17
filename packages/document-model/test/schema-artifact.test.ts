import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkSchema } from "../scripts/check-schema.js";
import { generateSchema } from "../scripts/generate-schema.js";

describe("CloudDocumentV1 JSON Schema artifact", () => {
  it("regenerates byte-identically and detects drift without Git", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-document-schema-test-"));
    const artifactPath = join(directory, "cloud-document-v1.schema.json");

    try {
      await generateSchema(artifactPath);
      const first = await readFile(artifactPath, "utf8");
      await generateSchema(artifactPath);
      expect(await readFile(artifactPath, "utf8")).toBe(first);
      expect(JSON.parse(first)).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "CloudDocumentV1",
        type: "object",
      });

      await expect(checkSchema(artifactPath)).resolves.toBeUndefined();
      await writeFile(artifactPath, `${first}\n`, "utf8");
      await expect(checkSchema(artifactPath)).rejects.toThrow(
        "cloud-document-v1.schema.json is out of date",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
