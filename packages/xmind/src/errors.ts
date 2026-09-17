export type XMindErrorCode =
  | "FILE_DAMAGED"
  | "ARCHIVE_LIMIT_EXCEEDED"
  | "ARCHIVE_PATH_UNSAFE"
  | "ARCHIVE_DUPLICATE_PATH"
  | "ARCHIVE_ENCRYPTED"
  | "ARCHIVE_UNSUPPORTED"
  | "CONTENT_MISSING"
  | "CONTENT_INVALID"
  | "XML_UNSAFE"
  | "XMIND_STRUCTURE_INVALID"
  | "IMAGE_PATH_UNSAFE"
  | "PROCESSING_TIMEOUT";

export class XMindError extends Error {
  readonly code: XMindErrorCode;

  constructor(code: XMindErrorCode, message: string) {
    super(message);
    this.name = "XMindError";
    this.code = code;
  }
}
