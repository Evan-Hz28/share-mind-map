export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type DocumentPriority = "P0" | "P1" | "P2";

export interface CloudNodeStyleV1 {
  textColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
}

export interface CloudRelationshipStyleV1 {
  color?: string;
  width?: number;
  pattern?: "solid" | "dashed" | "dotted";
}

export interface CloudNodeV1 {
  id: string;
  parentId: string | null;
  childIds: string[];
  title: string;
  priority: DocumentPriority | null;
  notes: { format: "plain"; text: string } | null;
  labels: string[];
  icons: string[];
  style: CloudNodeStyleV1;
  imageAssetId: string | null;
  extensions: Record<string, JsonValue>;
}

export interface CloudRelationshipV1 {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  title: string | null;
  style: CloudRelationshipStyleV1 | null;
  extensions: Record<string, JsonValue>;
}

export interface CloudSheetV1 {
  id: string;
  title: string;
  rootNodeId: string;
  nodes: Record<string, CloudNodeV1>;
  relationships: CloudRelationshipV1[];
  extensions: Record<string, JsonValue>;
}

export interface CloudDocumentV1 {
  schemaVersion: 1;
  documentId: string;
  version: number;
  sheets: CloudSheetV1[];
  extensions: Record<string, JsonValue>;
}

export type DocumentModelErrorCode =
  | "DOCUMENT_SCHEMA_INVALID"
  | "DOCUMENT_NODE_LIMIT_REACHED"
  | "DOCUMENT_SHEET_ID_DUPLICATE"
  | "DOCUMENT_NODE_ID_DUPLICATE"
  | "DOCUMENT_NODE_ID_MISMATCH"
  | "DOCUMENT_ROOT_INVALID"
  | "DOCUMENT_PARENT_CHILD_MISMATCH"
  | "DOCUMENT_NODE_UNREACHABLE"
  | "DOCUMENT_CYCLE"
  | "RELATIONSHIP_ID_DUPLICATE"
  | "RELATIONSHIP_SOURCE_MISSING"
  | "RELATIONSHIP_TARGET_MISSING";

export interface DocumentInvariantIssue {
  code: DocumentModelErrorCode;
  path: string;
  message: string;
}
