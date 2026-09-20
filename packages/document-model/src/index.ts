export { createInitialCloudDocument } from "./initial-document.js";
import { parseCloudDocumentValue } from "./snapshot.js";
import type { CloudDocumentV1 } from "./types.js";

export * from "./errors.js";
export * from "./invariants.js";
export * from "./schema.js";
export * from "./snapshot.js";
export type * from "./types.js";

export function parseCloudDocument(input: unknown): CloudDocumentV1 {
  return parseCloudDocumentValue(input);
}
