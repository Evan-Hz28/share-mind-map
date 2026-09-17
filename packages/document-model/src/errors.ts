import type { DocumentInvariantIssue, DocumentModelErrorCode } from "./types.js";

export class DocumentModelError extends Error {
  readonly code: DocumentModelErrorCode;
  readonly issues: readonly DocumentInvariantIssue[];

  constructor(
    code: DocumentModelErrorCode,
    message: string,
    issues: readonly DocumentInvariantIssue[],
  ) {
    super(message);
    this.name = "DocumentModelError";
    this.code = code;
    this.issues = issues;
  }
}
