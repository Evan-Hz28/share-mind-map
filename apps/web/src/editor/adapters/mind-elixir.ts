import {
  cloneCloudDocument,
  parseCloudDocument,
  validateCloudDocumentSnapshot,
  type CloudDocumentV1,
  type CloudNodeV1,
  type CloudSheetV1,
} from "@share-mind-map/document-model";
import MindElixir, { type MindElixirData, type NodeObj } from "mind-elixir";

import { randomUuid } from "../../utils/uuid.js";
import {
  cloneViewState,
  INITIAL_VIEW_STATE,
  type MindMapAdapter,
  type MindMapLayout,
  type MindMapViewState,
} from "./types.js";

type VendorNode = {
  id: string;
  direction?: number;
  children?: VendorNode[];
  expanded?: boolean;
  icons?: unknown[];
  note?: unknown;
  style?: Record<string, unknown>;
  tags?: unknown[];
  topic?: unknown;
};

const LAYOUT_EXTENSION_KEY = "share-mind-map.layout";
type BranchDirection = "left" | "right";

function readBranchDirection(extensions: Record<string, unknown>): BranchDirection | undefined {
  const layout = extensions[LAYOUT_EXTENSION_KEY];
  if (layout === null || typeof layout !== "object" || Array.isArray(layout)) return undefined;
  const direction = (layout as { direction?: unknown }).direction;
  return direction === "left" || direction === "right" ? direction : undefined;
}

function withBranchDirection(
  extensions: Record<string, CloudNodeV1["extensions"][string]>,
  direction: BranchDirection | undefined,
): CloudNodeV1["extensions"] {
  if (direction === undefined) return { ...extensions };
  return {
    ...extensions,
    [LAYOUT_EXTENSION_KEY]: { direction },
  };
}

function vendorDirection(direction: BranchDirection | undefined): 0 | 1 | undefined {
  if (direction === "left") return 0;
  if (direction === "right") return 1;
  return undefined;
}

function branchDirection(direction: unknown): BranchDirection | undefined {
  if (direction === MindElixir.LEFT) return "left";
  if (direction === MindElixir.RIGHT) return "right";
  return undefined;
}

/**
 * Splits root branches by subtree leaf count so both sides span a similar height.
 * Leaf counts come from the full tree, not the current expansion state, so
 * expanding or collapsing never moves an already placed branch to the other side.
 */
function rootBranchDirections(sheet: CloudSheetV1): ReadonlyMap<string, BranchDirection> {
  const root = sheet.nodes[sheet.rootNodeId];
  if (root === undefined) return new Map<string, BranchDirection>();
  const leaves = new Map<string, number>();
  const countLeaves = (nodeId: string): number => {
    const cached = leaves.get(nodeId);
    if (cached !== undefined) return cached;
    const node = sheet.nodes[nodeId];
    const count =
      node === undefined || node.childIds.length === 0
        ? 1
        : node.childIds.reduce((total, childId) => total + countLeaves(childId), 0);
    leaves.set(nodeId, count);
    return count;
  };
  const weights = root.childIds.map((nodeId) => countLeaves(nodeId));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cut = weights.length;
  let best = Number.POSITIVE_INFINITY;
  let prefix = 0;
  for (let index = 0; index < weights.length - 1; index += 1) {
    prefix += weights[index] ?? 0;
    const difference = Math.abs(total - 2 * prefix);
    if (difference < best) {
      best = difference;
      cut = index + 1;
    }
  }
  return new Map<string, BranchDirection>(
    root.childIds.map((nodeId, index) => [nodeId, index < cut ? "right" : "left"] as const),
  );
}

type MindElixirBus = {
  addListener(name: string, listener: (payload: unknown) => void): void;
  removeListener(name: string, listener: (payload: unknown) => void): void;
};

type PriorityMetadata = { priority: NonNullable<CloudNodeV1["priority"]> };

const PRIORITY_BADGE_LABELS: Record<PriorityMetadata["priority"], string> = {
  P0: "1",
  P1: "2",
  P2: "3",
};

type MapTranslation = { x: number; y: number };

function readMapTranslation(transform: string): MapTranslation {
  const match = transform.match(
    /translate3d\(\s*(-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px,\s*0(?:px)?\s*\)/u,
  );
  if (match === null) return { x: 0, y: 0 };
  return { x: Number(match[1]), y: Number(match[2]) };
}

function installUnboundedPan(instance: MindElixir): void {
  instance.move = (dx, dy, smooth = false) => {
    if (dx === 0 && dy === 0) return false;
    const translation = readMapTranslation(instance.map.style.transform);
    if (smooth) {
      instance.map.style.transition = "transform 0.3s";
      globalThis.setTimeout(() => {
        instance.map.style.transition = "none";
      }, 300);
    }
    const nextX = String(translation.x + dx);
    const nextY = String(translation.y + dy);
    const scale = String(instance.scaleVal);
    instance.map.style.transform = `translate3d(${nextX}px, ${nextY}px, 0) scale(${scale})`;
    instance.bus.fire("move", { dx, dy });
    return true;
  };
}

function applyPriorityBadge(topic: HTMLElement, nodeObj: NodeObj<PriorityMetadata>): void {
  const priority = nodeObj.metadata?.priority;
  if (priority === undefined) return;
  if (topic.firstElementChild?.classList.contains("priority-badge") === true) return;
  const badge = topic.ownerDocument.createElement("span");
  badge.className = `priority-badge priority-badge--${priority.toLowerCase()}`;
  badge.textContent = PRIORITY_BADGE_LABELS[priority];
  topic.prepend(badge);
}

function installPriorityBadges(instance: MindElixir): void {
  const createWrapper = instance.createWrapper.bind(instance);
  instance.createWrapper = (nodeObj, omitChildren) => {
    const wrapper = createWrapper(nodeObj, omitChildren);
    applyPriorityBadge(wrapper.tpc, nodeObj as NodeObj<PriorityMetadata>);
    return wrapper;
  };
  const layout = instance.layout.bind(instance);
  instance.layout = () => {
    layout();
    const rootTopic = instance.el.querySelector<HTMLElement>(".me-root > .me-tpc");
    if (rootTopic !== null) {
      applyPriorityBadge(rootTopic, instance.nodeData as NodeObj<PriorityMetadata>);
    }
  };
}

function uuid(value: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    return value;
  }
  return randomUuid();
}

function toMindElixirNode(
  sheet: CloudSheetV1,
  node: CloudNodeV1,
  expanded: ReadonlySet<string>,
  rootDirections: ReadonlyMap<string, BranchDirection>,
): NodeObj<PriorityMetadata> {
  return {
    id: node.id,
    topic: node.title,
    ...(node.priority === null ? {} : { metadata: { priority: node.priority } }),
    ...(node.parentId === sheet.rootNodeId
      ? (() => {
          const direction = vendorDirection(
            readBranchDirection(node.extensions) ?? rootDirections.get(node.id),
          );
          return direction === undefined ? {} : { direction };
        })()
      : {}),
    expanded: node.parentId === null || expanded.has(node.id),
    children: node.childIds.map((childId) => {
      const child = sheet.nodes[childId];
      if (child === undefined) throw new Error(`Missing child node ${childId}.`);
      return toMindElixirNode(sheet, child, expanded, rootDirections);
    }),
    ...(node.labels.length > 0 ? { tags: [...node.labels] } : {}),
    ...(node.icons.length > 0 ? { icons: [...node.icons] } : {}),
    ...(node.notes === null ? {} : { note: node.notes.text }),
    ...(Object.keys(node.style).length === 0
      ? {}
      : {
          style: {
            ...(node.style.fontSize === undefined
              ? {}
              : { fontSize: `${String(node.style.fontSize)}px` }),
            ...(node.style.fontFamily === undefined ? {} : { fontFamily: node.style.fontFamily }),
            ...(node.style.textColor === undefined ? {} : { color: node.style.textColor }),
            ...(node.style.backgroundColor === undefined
              ? {}
              : { background: node.style.backgroundColor }),
            ...(node.style.fontWeight === undefined
              ? {}
              : { fontWeight: String(node.style.fontWeight) }),
          },
        }),
  };
}

function styleFromVendor(style: Record<string, unknown> | undefined): CloudNodeV1["style"] {
  if (style === undefined) return {};
  const fontSize = typeof style.fontSize === "string" ? Number(style.fontSize) : style.fontSize;
  const fontWeight =
    typeof style.fontWeight === "string" ? Number(style.fontWeight) : style.fontWeight;
  return {
    ...(typeof style.color === "string" ? { textColor: style.color } : {}),
    ...(typeof style.background === "string" ? { backgroundColor: style.background } : {}),
    ...(typeof style.fontFamily === "string" ? { fontFamily: style.fontFamily } : {}),
    ...(typeof fontSize === "number" && Number.isFinite(fontSize) ? { fontSize } : {}),
    ...(typeof fontWeight === "number" && Number.isFinite(fontWeight) ? { fontWeight } : {}),
  };
}

function nodeFromVendor(
  vendor: VendorNode,
  parentId: string | null,
  previous: Record<string, CloudNodeV1>,
  idMap: Map<string, string>,
  collected: Record<string, CloudNodeV1>,
  depth = 0,
  persistDirections = false,
): CloudNodeV1 {
  const vendorId = vendor.id;
  const existingId = idMap.get(vendorId);
  const id = existingId ?? uuid(vendorId);
  idMap.set(vendorId, id);
  const old = previous[id];
  const children = (vendor.children ?? []).map((child) =>
    nodeFromVendor(child, id, previous, idMap, collected, depth + 1, persistDirections),
  );
  const title = typeof vendor.topic === "string" ? vendor.topic : (old?.title ?? "");
  const tags = Array.isArray(vendor.tags)
    ? vendor.tags.filter((tag): tag is string => typeof tag === "string")
    : (old?.labels ?? []);
  const icons = Array.isArray(vendor.icons)
    ? vendor.icons.filter((icon): icon is string => typeof icon === "string")
    : (old?.icons ?? []);
  const note =
    typeof vendor.note === "string"
      ? { format: "plain" as const, text: vendor.note }
      : (old?.notes ?? null);
  const persistedDirection =
    persistDirections && depth === 1
      ? (branchDirection(vendor.direction) ?? readBranchDirection(old?.extensions ?? {}))
      : undefined;
  const result: CloudNodeV1 = {
    id,
    parentId,
    childIds: children.map((child) => child.id),
    title,
    priority: old?.priority ?? null,
    notes: note,
    labels: tags,
    icons,
    style:
      Object.keys(vendor.style ?? {}).length > 0
        ? styleFromVendor(vendor.style)
        : (old?.style ?? {}),
    imageAssetId: old?.imageAssetId ?? null,
    extensions: withBranchDirection(old?.extensions ?? {}, persistedDirection),
  };
  collected[result.id] = result;
  return result;
}

function standardFromVendor(
  base: CloudDocumentV1,
  data: MindElixirData,
  idMap: Map<string, string>,
  persistDirections = false,
): CloudDocumentV1 {
  const baseSheet = base.sheets[0];
  if (baseSheet === undefined) throw new Error("The snapshot does not contain a sheet.");
  const root = data.nodeData as VendorNode;
  const nodes: Record<string, CloudNodeV1> = {};
  const rootNode = nodeFromVendor(root, null, baseSheet.nodes, idMap, nodes, 0, persistDirections);
  const relationships = baseSheet.relationships.filter(
    (relationship) =>
      nodes[relationship.sourceNodeId] !== undefined &&
      nodes[relationship.targetNodeId] !== undefined,
  );
  return parseCloudDocument({
    ...base,
    sheets: [{ ...baseSheet, rootNodeId: rootNode.id, nodes, relationships }],
  });
}

export class MindElixirAdapter implements MindMapAdapter {
  private instance: MindElixir | null = null;
  private snapshot: CloudDocumentV1 | null = null;
  private viewState = cloneViewState(INITIAL_VIEW_STATE);
  private readonly listeners = new Set<(document: CloudDocumentV1) => void>();
  private readonly vendorIds = new Map<string, string>();
  private readonly operationListener = (payload: unknown): void => {
    const operation = payload as { name?: unknown };
    if (operation.name === "beginEdit") {
      this.focusEditingInput();
      return;
    }
    this.publishVendorSnapshot(
      typeof operation.name === "string" && operation.name.startsWith("moveNodes"),
    );
  };
  private readonly zoomListeners = new Set<(zoom: number) => void>();
  private readonly scaleListener = (payload: unknown): void => {
    if (typeof payload !== "number" || !Number.isFinite(payload)) return;
    this.viewState.viewport.zoom = payload;
    for (const listener of this.zoomListeners) listener(payload);
  };
  private readonly expandListener = (payload: unknown): void => {
    const node = payload as { id?: unknown; expanded?: unknown };
    if (typeof node.id !== "string" || typeof node.expanded !== "boolean") return;
    if (node.id === this.requireSheet().rootNodeId) return;
    const expandedNodeIds = new Set(this.viewState.expandedNodeIds);
    if (node.expanded) expandedNodeIds.add(node.id);
    else expandedNodeIds.delete(node.id);
    this.viewState.expandedNodeIds = [...expandedNodeIds];
  };

  public constructor(private readonly host: HTMLElement) {}

  public async mount(document: CloudDocumentV1): Promise<void> {
    this.destroy();
    this.snapshot = validateCloudDocumentSnapshot(document);
    const instance = new MindElixir({
      el: this.host,
      theme: MindElixir.THEME,
      editable: !this.viewState.readOnly,
      contextMenu: true,
      toolBar: false,
      keypress: true,
      allowUndo: true,
      overflowHidden: false,
    });
    installUnboundedPan(instance);
    installPriorityBadges(instance);
    this.instance = instance;
    const error = await instance.init(this.vendorData());
    if (error !== undefined) throw error;
    this.bus().addListener("operation", this.operationListener);
    this.bus().addListener("expandNode", this.expandListener);
    this.bus().addListener("scale", this.scaleListener);
    await this.applyViewState();
  }

  public async applySnapshot(document: CloudDocumentV1): Promise<void> {
    this.snapshot = validateCloudDocumentSnapshot(document);
    this.vendorIds.clear();
    this.requireInstance().refresh(this.vendorData());
    await this.applyViewState();
  }

  public acceptSavedSnapshot(document: CloudDocumentV1): void {
    // 画布内容已经就是这份快照,refresh 只会重建 DOM 并打断正在进行的拖拽。
    this.snapshot = validateCloudDocumentSnapshot(document);
  }

  public exportSnapshot(): CloudDocumentV1 {
    if (this.snapshot === null) throw new Error("The adapter is not mounted.");
    return this.snapshotFromVendor();
  }

  public onChange(listener: (document: CloudDocumentV1) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public undo(): void {
    if (this.viewState.readOnly) return;
    this.requireInstance().undo();
  }

  public redo(): void {
    if (this.viewState.readOnly) return;
    this.requireInstance().redo();
  }

  public async addChild(): Promise<void> {
    if (this.viewState.readOnly) return;
    const instance = this.requireInstance();
    const currentNode = instance.currentNode;
    if (currentNode === null) return;

    const vendorNode = currentNode.nodeObj as VendorNode;
    if ((vendorNode.children?.length ?? 0) > 0) {
      await instance.addChild();
      return;
    }

    await this.addChildToLeaf(vendorNode.id);
  }

  public async addSibling(): Promise<void> {
    if (this.viewState.readOnly || this.requireInstance().currentNode === null) return;
    await this.requireInstance().insertSibling("after");
  }

  public async removeSelected(): Promise<void> {
    if (this.viewState.readOnly) return;
    const instance = this.requireInstance();
    const selectedNodes = instance.currentNodes.filter((node) => node.nodeObj.parent !== undefined);
    if (selectedNodes.length === 0) return;
    await instance.removeNodes(selectedNodes);
  }

  public async setLayout(layout: MindMapLayout): Promise<void> {
    const instance = this.requireInstance();
    if (layout === "left") instance.initLeft();
    else if (layout === "right") instance.initRight();
    else instance.initSide();
    await this.afterRender();
  }

  public fitToView(): void {
    const instance = this.requireInstance();
    instance.scaleFit();
    if (Number.isFinite(instance.scaleVal)) this.viewState.viewport.zoom = instance.scaleVal;
  }

  public zoomIn(): void {
    this.setZoom(this.requireInstance().scaleVal + 0.1);
  }

  public zoomOut(): void {
    this.setZoom(this.requireInstance().scaleVal - 0.1);
  }

  public onZoomChange(listener: (zoom: number) => void): () => void {
    this.zoomListeners.add(listener);
    return () => {
      this.zoomListeners.delete(listener);
    };
  }

  public async focusNode(nodeId: string): Promise<boolean> {
    const instance = this.requireInstance();
    if (this.requireSheet().nodes[nodeId] === undefined) return false;
    const node = instance.findEle(nodeId, this.host);
    instance.selectNode(node);
    instance.scrollIntoView(node, true);
    this.viewState.selectedNodeId = nodeId;
    await this.afterRender();
    return true;
  }

  public getViewState(): MindMapViewState {
    return cloneViewState(this.viewState);
  }

  public async restoreViewState(state: MindMapViewState): Promise<void> {
    this.viewState = cloneViewState(state);
    this.requireInstance().refresh(this.vendorData());
    await this.applyViewState();
  }

  public async setAllExpanded(expanded: boolean): Promise<void> {
    const sheet = this.requireSheet();
    this.viewState.expandedNodeIds = expanded
      ? Object.values(sheet.nodes)
          .filter((node) => node.childIds.length > 0)
          .map((node) => node.id)
      : [];
    this.requireInstance().refresh(this.vendorData());
    this.fitToView();
    await this.applyViewState();
  }

  public setReadOnly(readOnly: boolean): void {
    this.viewState.readOnly = readOnly;
    const instance = this.requireInstance();
    if (readOnly) instance.disableEdit();
    else instance.enableEdit();
  }

  public destroy(): void {
    if (this.instance !== null) {
      this.bus().removeListener("operation", this.operationListener);
      this.bus().removeListener("expandNode", this.expandListener);
      this.bus().removeListener("scale", this.scaleListener);
      this.instance.destroy();
    }
    this.instance = null;
    this.snapshot = null;
    this.vendorIds.clear();
    this.host.replaceChildren();
  }

  private publishVendorSnapshot(persistDirections = false): void {
    const next = this.snapshotFromVendor(persistDirections);
    this.snapshot = next;
    const cloned = cloneCloudDocument(next);
    for (const listener of this.listeners) listener(cloned);
  }

  private async addChildToLeaf(vendorNodeId: string): Promise<void> {
    const snapshot = this.snapshot;
    if (snapshot === null) throw new Error("The adapter is not mounted.");

    const sheet = snapshot.sheets[0];
    if (sheet === undefined) throw new Error("The snapshot does not contain a sheet.");

    const parentId = this.vendorIds.get(vendorNodeId) ?? vendorNodeId;
    const parent = sheet.nodes[parentId];
    if (parent === undefined) throw new Error(`Missing node ${parentId}.`);

    const childId = randomUuid();
    const next = cloneCloudDocument(snapshot);
    const nextSheet = next.sheets[0];
    if (nextSheet === undefined) throw new Error("The snapshot does not contain a sheet.");

    const nextParent = nextSheet.nodes[parentId];
    if (nextParent === undefined) throw new Error(`Missing node ${parentId}.`);
    nextParent.childIds = [...parent.childIds, childId];
    nextSheet.nodes[childId] = {
      id: childId,
      parentId,
      childIds: [],
      title: "New Node",
      priority: null,
      notes: null,
      labels: [],
      icons: [],
      style: {},
      imageAssetId: null,
      extensions: {},
    };

    this.snapshot = validateCloudDocumentSnapshot(next);
    this.vendorIds.clear();
    this.viewState.selectedNodeId = childId;
    this.viewState.expandedNodeIds = [...new Set([...this.viewState.expandedNodeIds, parentId])];
    const instance = this.requireInstance();
    instance.refresh(this.vendorData());
    await this.applyViewState();
    this.publishVendorSnapshot();
    void instance.beginEdit(instance.findEle(childId, this.host));
  }

  private snapshotFromVendor(persistDirections = false): CloudDocumentV1 {
    const snapshot = this.snapshot;
    if (snapshot === null) throw new Error("The adapter is not mounted.");
    const data = this.requireInstance().getData();
    return standardFromVendor(snapshot, data, this.vendorIds, persistDirections);
  }

  private focusEditingInput(): void {
    const input = this.host.querySelector<HTMLElement>("#input-box");
    if (input === null) return;
    input.focus();

    const selection = globalThis.getSelection();
    if (selection === null) return;
    const range = input.ownerDocument.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private vendorData(): MindElixirData {
    const sheet = this.requireSheet();
    return {
      nodeData: toMindElixirNode(
        sheet,
        this.requireNode(sheet, sheet.rootNodeId),
        new Set(this.viewState.expandedNodeIds),
        rootBranchDirections(sheet),
      ),
      direction: MindElixir.SIDE,
    };
  }

  private async applyViewState(): Promise<void> {
    const instance = this.requireInstance();
    if (this.viewState.readOnly) instance.disableEdit();
    else instance.enableEdit();
    instance.scale(this.viewState.viewport.zoom);
    instance.move(this.viewState.viewport.x, this.viewState.viewport.y);
    if (
      this.viewState.selectedNodeId !== null &&
      this.requireSheet().nodes[this.viewState.selectedNodeId]
    ) {
      const node = instance.findEle(this.viewState.selectedNodeId, this.host);
      instance.selectNode(node);
    }
    await this.afterRender();
  }

  private setZoom(zoom: number): void {
    const instance = this.requireInstance();
    const nextZoom = Math.min(instance.scaleMax, Math.max(instance.scaleMin, zoom));
    instance.scale(nextZoom);
    this.viewState.viewport.zoom = nextZoom;
  }

  private bus(): MindElixirBus {
    const instance = this.requireInstance() as unknown as { bus: MindElixirBus };
    return instance.bus;
  }

  private requireInstance(): MindElixir {
    if (this.instance === null) throw new Error("The adapter is not mounted.");
    return this.instance;
  }

  private requireSheet(): CloudSheetV1 {
    const sheet = this.snapshot?.sheets[0];
    if (sheet === undefined) throw new Error("The snapshot does not contain a sheet.");
    return sheet;
  }

  private requireNode(sheet: CloudSheetV1, nodeId: string): CloudNodeV1 {
    const node = sheet.nodes[nodeId];
    if (node === undefined) throw new Error(`Missing node ${nodeId}.`);
    return node;
  }

  private async afterRender(): Promise<void> {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
  }
}
