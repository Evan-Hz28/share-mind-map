import type { CloudDocumentV1, CloudNodeV1, CloudSheetV1 } from "@share-mind-map/document-model";
import MindElixir, { type MindElixirData, type NodeObj } from "mind-elixir";

import {
  cloneDocument,
  cloneViewState,
  INITIAL_VIEW_STATE,
  type MindMapAdapter,
  type MindMapViewState,
} from "../types.js";

function toMindElixirNode(
  sheet: CloudSheetV1,
  node: CloudNodeV1,
  expanded: ReadonlySet<string>,
): NodeObj {
  return {
    id: node.id,
    topic: node.title,
    expanded: node.parentId === null || expanded.has(node.id),
    children: node.childIds.map((childId) => {
      const child = sheet.nodes[childId];
      if (child === undefined) throw new Error(`Missing child node ${childId}.`);
      return toMindElixirNode(sheet, child, expanded);
    }),
    ...(node.labels.length > 0 ? { tags: [...node.labels] } : {}),
    ...(node.icons.length > 0 ? { icons: [...node.icons] } : {}),
    ...(node.notes === null ? {} : { note: node.notes.text }),
    ...(Object.keys(node.style).length === 0
      ? {}
      : {
          style: {
            ...(node.style.fontSize === undefined ? {} : { fontSize: String(node.style.fontSize) }),
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

export class MindElixirAdapter implements MindMapAdapter {
  private instance: MindElixir | null = null;
  private snapshot: CloudDocumentV1 | null = null;
  private viewState = cloneViewState(INITIAL_VIEW_STATE);

  public constructor(private readonly host: HTMLElement) {}

  public async mount(document: CloudDocumentV1): Promise<void> {
    this.destroy();
    this.snapshot = cloneDocument(document);
    const instance = new MindElixir({
      el: this.host,
      editable: !this.viewState.readOnly,
      contextMenu: false,
      toolBar: false,
      keypress: false,
      allowUndo: true,
      overflowHidden: true,
    });
    this.instance = instance;
    const error = await instance.init(this.vendorData());
    if (error !== undefined) throw error;
    await this.applyViewState();
  }

  public async applySnapshot(document: CloudDocumentV1): Promise<void> {
    this.snapshot = cloneDocument(document);
    this.requireInstance().refresh(this.vendorData());
    await this.applyViewState();
  }

  public exportSnapshot(): CloudDocumentV1 {
    if (this.snapshot === null) throw new Error("The adapter is not mounted.");
    void this.requireInstance().getData();
    return cloneDocument(this.snapshot);
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

  public setReadOnly(readOnly: boolean): void {
    this.viewState.readOnly = readOnly;
    const instance = this.requireInstance();
    if (readOnly) instance.disableEdit();
    else instance.enableEdit();
  }

  public destroy(): void {
    this.instance?.destroy();
    this.instance = null;
    this.snapshot = null;
    this.host.replaceChildren();
  }

  private vendorData(): MindElixirData {
    const sheet = this.requireSheet();
    return {
      nodeData: toMindElixirNode(
        sheet,
        this.requireNode(sheet, sheet.rootNodeId),
        new Set(this.viewState.expandedNodeIds),
      ),
      direction: MindElixir.RIGHT,
    };
  }

  private async applyViewState(): Promise<void> {
    const instance = this.requireInstance();
    if (this.viewState.readOnly) instance.disableEdit();
    else instance.enableEdit();
    instance.scale(this.viewState.viewport.zoom);
    instance.move(this.viewState.viewport.x, this.viewState.viewport.y);
    if (this.viewState.selectedNodeId !== null) {
      const node = instance.findEle(this.viewState.selectedNodeId, this.host);
      instance.selectNode(node);
    }
    await this.afterRender();
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
