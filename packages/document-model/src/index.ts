import { DocumentModelError } from "./errors.js";
import { validateDocumentInvariants } from "./invariants.js";
import { cloudDocumentV1Schema } from "./schema.js";
import type { CloudDocumentV1, DocumentInvariantIssue } from "./types.js";

export * from "./errors.js";
export * from "./invariants.js";
export * from "./schema.js";
export type * from "./types.js";

export function parseCloudDocument(input: unknown): CloudDocumentV1 {
  const result = cloudDocumentV1Schema.safeParse(input);
  if (!result.success) {
    const issues: DocumentInvariantIssue[] = result.error.issues.slice(0, 100).map((issue) => ({
      code: "DOCUMENT_SCHEMA_INVALID",
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new DocumentModelError(
      "DOCUMENT_SCHEMA_INVALID",
      "Cloud document does not match Schema V1.",
      issues,
    );
  }

  const document = result.data as CloudDocumentV1;
  const issues = validateDocumentInvariants(document);
  const firstIssue = issues[0];
  if (firstIssue !== undefined) {
    throw new DocumentModelError(firstIssue.code, firstIssue.message, issues);
  }
  return document;
}
