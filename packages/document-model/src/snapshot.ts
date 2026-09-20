import { DocumentModelError } from "./errors.js";
import { validateDocumentInvariants } from "./invariants.js";
import { cloudDocumentV1Schema } from "./schema.js";
import type { CloudDocumentV1, DocumentInvariantIssue } from "./types.js";

function schemaIssues(input: unknown): DocumentInvariantIssue[] {
  const result = cloudDocumentV1Schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.slice(0, 100).map((issue) => ({
    code: "DOCUMENT_SCHEMA_INVALID",
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function parseCloudDocumentValue(input: unknown): CloudDocumentV1 {
  const result = cloudDocumentV1Schema.safeParse(input);
  if (!result.success) {
    const issues = schemaIssues(input);
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

export function validateCloudDocumentSnapshot(input: unknown): CloudDocumentV1 {
  return cloneCloudDocument(parseCloudDocumentValue(input));
}

export function cloneCloudDocument(document: CloudDocumentV1): CloudDocumentV1 {
  return structuredClone(document);
}

export function normalizeCloudDocumentVersion(
  document: CloudDocumentV1,
  version: number,
): CloudDocumentV1 {
  if (!Number.isInteger(version) || version < 0) {
    throw new RangeError("Document version must be a non-negative integer.");
  }
  const normalized = cloneCloudDocument(parseCloudDocumentValue(document));
  normalized.version = version;
  return normalized;
}
