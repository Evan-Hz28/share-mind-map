import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { cloudDocumentV1Schema } from "../src/schema.js";

export const defaultSchemaPath = fileURLToPath(
  new URL("../schema/cloud-document-v1.schema.json", import.meta.url),
);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortKeys(entry)]),
  );
}

export function renderSchema(): string {
  const schema = z.toJSONSchema(cloudDocumentV1Schema, {
    target: "draft-2020-12",
    reused: "ref",
  });
  const artifact = { ...schema, title: "CloudDocumentV1" };
  return `${JSON.stringify(sortKeys(artifact), null, 2)}\n`;
}

export async function generateSchema(outputPath = defaultSchemaPath): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderSchema(), "utf8");
}

const entryPath = process.argv[1];
if (entryPath !== undefined && fileURLToPath(import.meta.url) === resolve(entryPath)) {
  await generateSchema();
  console.log(`Generated ${defaultSchemaPath}`);
}
