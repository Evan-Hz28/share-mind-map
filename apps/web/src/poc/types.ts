import type { CloudDocumentV1 } from "@share-mind-map/document-model";

export const CANVAS_CANDIDATES = ["simple-mind-map", "mind-elixir", "jsmind"] as const;

export type CanvasCandidate = (typeof CANVAS_CANDIDATES)[number];

export type MindMapViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type MindMapViewState = {
  selectedNodeId: string | null;
  expandedNodeIds: string[];
  viewport: MindMapViewport;
  readOnly: boolean;
};

export type MindMapAdapter = {
  mount(document: CloudDocumentV1): Promise<void>;
  applySnapshot(document: CloudDocumentV1): Promise<void>;
  exportSnapshot(): CloudDocumentV1;
  focusNode(nodeId: string): Promise<boolean>;
  getViewState(): MindMapViewState;
  restoreViewState(state: MindMapViewState): Promise<void>;
  setReadOnly(readOnly: boolean): void;
  destroy(): void;
};

export type CanvasFunctionalChecks = {
  readOnly: boolean;
  focus: boolean;
  zoomPan: boolean;
  collapse: boolean;
  snapshotReplacement: boolean;
  stateRestoration: boolean;
  deterministicExport: boolean;
  cleanup: boolean;
};

export type CanvasCapabilities = {
  readOnly: boolean;
  stableIds: boolean;
  createDelete: boolean;
  reparenting: boolean;
  reordering: boolean;
  collapse: boolean;
  keyboardHooks: boolean;
  zoomPan: boolean;
  undoHook: boolean;
  image: boolean;
  label: boolean;
  icon: boolean;
  basicStyle: boolean;
  snapshotReplacement: boolean;
  stateRestoration: boolean;
  deterministicExport: boolean;
  cleanup: boolean;
  noCloudDependency: boolean;
};

export type CanvasBenchmarkMeasurement = {
  mountMs: number;
  firstUsableMs: number;
  replacementMs: number;
  interactionMs: number;
  heap: {
    beforeMount: number | null;
    afterMount: number | null;
    afterReplacement: number | null;
    afterDestroy: number | null;
  };
  exportChecksum: string;
  functional: CanvasFunctionalChecks;
};

export type CanvasPocRuntime = {
  ready: boolean;
  candidate: CanvasCandidate;
  nodeCount: number;
  heapBeforeMount: number | null;
  capabilities: CanvasCapabilities;
  errors: string[];
  runFunctionalChecks(): Promise<CanvasFunctionalChecks>;
  runBenchmark(): Promise<CanvasBenchmarkMeasurement>;
};

declare global {
  interface Window {
    __CANVAS_POC__?: CanvasPocRuntime;
  }
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
