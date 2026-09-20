import type { CloudDocumentV1 } from "@share-mind-map/document-model";

export type MindMapViewport = { x: number; y: number; zoom: number };

export type MindMapViewState = {
  selectedNodeId: string | null;
  expandedNodeIds: string[];
  viewport: MindMapViewport;
  readOnly: boolean;
};

export interface MindMapAdapter {
  mount(document: CloudDocumentV1): Promise<void>;
  applySnapshot(document: CloudDocumentV1): Promise<void>;
  exportSnapshot(): CloudDocumentV1;
  onChange(listener: (document: CloudDocumentV1) => void): () => void;
  focusNode(nodeId: string): Promise<boolean>;
  getViewState(): MindMapViewState;
  restoreViewState(state: MindMapViewState): Promise<void>;
  setReadOnly(readOnly: boolean): void;
  destroy(): void;
}

export const INITIAL_VIEW_STATE: MindMapViewState = {
  selectedNodeId: null,
  expandedNodeIds: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  readOnly: false,
};

export function cloneDocument(document: CloudDocumentV1): CloudDocumentV1 {
  return structuredClone(document);
}

export function cloneViewState(state: MindMapViewState): MindMapViewState {
  return structuredClone(state);
}
