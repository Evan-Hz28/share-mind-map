import type { JsonValue } from "@share-mind-map/document-model";

export type CompatibilityDisposition =
  "preserved" | "normalized" | "unsupported_online" | "rejected";

export interface CompatibilityIssue {
  featurePath: string;
  disposition: CompatibilityDisposition;
  message: string;
}

export interface XMindNodeStyle {
  textColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
}

export interface XMindRelationshipStyle {
  color?: string;
  width?: number;
  pattern?: "solid" | "dashed" | "dotted";
}

export interface XMindNode {
  sourceId: string;
  parentSourceId: string | null;
  childSourceIds: string[];
  title: string;
  priority: "P0" | "P1" | "P2" | null;
  notes: string | null;
  labels: string[];
  icons: string[];
  style: XMindNodeStyle;
  imagePath: string | null;
  extensions: Record<string, JsonValue>;
}

export interface XMindRelationship {
  sourceId: string;
  sourceNodeId: string;
  targetNodeId: string;
  title: string | null;
  style: XMindRelationshipStyle | null;
  extensions: Record<string, JsonValue>;
}

export interface XMindSheet {
  sourceId: string;
  title: string;
  rootSourceId: string;
  nodes: Record<string, XMindNode>;
  relationships: XMindRelationship[];
  extensions: Record<string, JsonValue>;
}

export interface XMindAsset {
  path: string;
  mediaType: string;
  uncompressedSize: number;
}

export interface XMindInspection {
  format: "content-json" | "content-xml";
  entries: string[];
  sheets: XMindSheet[];
  assets: Record<string, XMindAsset>;
  compatibility: CompatibilityIssue[];
}

export interface XMindDocumentIdentity {
  documentId: string;
  version: number;
}
