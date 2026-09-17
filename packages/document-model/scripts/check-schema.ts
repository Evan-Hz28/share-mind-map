import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultSchemaPath, generateSchema } from "./generate-schema.js";

export async function checkSchema(expectedPath = defaultSchemaPath): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "cloud-document-schema-check-"));
  const generatedPath = join(directory, "cloud-document-v1.schema.json");

  try {
    await generateSchema(generatedPath);
    const [expected, generated] = await Promise.all([
      readFile(expectedPath, "utf8"),
      readFile(generatedPath, "utf8"),
    ]);
    if (expected !== generated) {
      throw new Error(
        "cloud-document-v1.schema.json is out of date; run pnpm --filter @share-mind-map/document-model generate:schema",
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && fileURLToPath(import.meta.url) === resolve(entryPath)) {
  await checkSchema();
  console.log("CloudDocumentV1 JSON Schema is current.");
}
