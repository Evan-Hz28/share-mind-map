import type { CloudDocumentV1, CloudNodeV1, CloudSheetV1 } from "@share-mind-map/document-model";
import JsMind, { type NodeTreeData, type NodeTreeFormat } from "jsmind";

import {
  cloneDocument,
  cloneViewState,
  INITIAL_VIEW_STATE,
  type MindMapAdapter,
  type MindMapViewState,
} from "../types.js";

function toJsMindNode(
  sheet: CloudSheetV1,
  node: CloudNodeV1,
  expanded: ReadonlySet<string>,
): NodeTreeData {
  return {
    id: node.id,
    topic: node.title,
    expanded: node.parentId === null || expanded.has(node.id),
    data: {
      labels: [...node.labels],
      icons: [...node.icons],
      notes: node.notes?.text ?? null,
      ...node.style,
    },
    children: node.childIds.map((childId) => {
      const child = sheet.nodes[childId];
      if (child === undefined) throw new Error(`Missing child node ${childId}.`);
      return toJsMindNode(sheet, child, expanded);
    }),
  };
}

export class JsMindAdapter implements MindMapAdapter {
  private instance: JsMind | null = null;
  private snapshot: CloudDocumentV1 | null = null;
  private viewState = cloneViewState(INITIAL_VIEW_STATE);

  public constructor(private readonly host: HTMLElement) {}

  public async mount(document: CloudDocumentV1): Promise<void> {
    this.destroy();
    this.snapshot = cloneDocument(document);
    const instance = new JsMind({
      container: this.host,
      editable: !this.viewState.readOnly,
      mode: "full",
      support_html: false,
      log_level: "error",
      view: { engine: "svg", draggable: true, hide_scrollbars_when_draggable: false },
      shortcut: { enable: false },
    });
    this.instance = instance;
    instance.show(this.vendorData());
    await this.applyViewState();
  }

  public async applySnapshot(document: CloudDocumentV1): Promise<void> {
    this.snapshot = cloneDocument(document);
    this.requireInstance().show(this.vendorData());
    await this.applyViewState();
  }

  public exportSnapshot(): CloudDocumentV1 {
    if (this.snapshot === null) throw new Error("The adapter is not mounted.");
    void this.requireInstance().get_data("node_tree");
    return cloneDocument(this.snapshot);
  }

  public async focusNode(nodeId: string): Promise<boolean> {
    const instance = this.requireInstance();
    if (this.requireSheet().nodes[nodeId] === undefined) return false;
    const node = instance.get_node(nodeId);
    instance.select_node(node);
    instance.scroll_node_to_center(node);
    this.viewState.selectedNodeId = nodeId;
    await this.afterRender();
    return true;
  }

  public getViewState(): MindMapViewState {
    return cloneViewState(this.viewState);
  }

  public async restoreViewState(state: MindMapViewState): Promise<void> {
    this.viewState = cloneViewState(state);
    await this.applyViewState();
  }

  public setReadOnly(readOnly: boolean): void {
    this.viewState.readOnly = readOnly;
    const instance = this.requireInstance();
    if (readOnly) instance.disable_edit();
    else instance.enable_edit();
  }

  public destroy(): void {
    if (this.instance !== null) {
      this.instance.clear_event_listener();
      this.instance._reset();
    }
    this.instance = null;
    this.snapshot = null;
    this.host.replaceChildren();
  }

  private vendorData(): NodeTreeFormat {
    const sheet = this.requireSheet();
    return {
      meta: { name: sheet.title, author: "share-mind-map", version: "1" },
      format: "node_tree",
      data: toJsMindNode(
        sheet,
        this.requireNode(sheet, sheet.rootNodeId),
        new Set(this.viewState.expandedNodeIds),
      ),
    };
  }

  private async applyViewState(): Promise<void> {
    const instance = this.requireInstance();
    if (this.viewState.readOnly) instance.disable_edit();
    else instance.enable_edit();
    instance.view.set_zoom(this.viewState.viewport.zoom);
    this.host.scrollLeft = Math.max(0, -this.viewState.viewport.x);
    this.host.scrollTop = Math.max(0, -this.viewState.viewport.y);
    for (const nodeId of this.viewState.expandedNodeIds) instance.expand_node(nodeId);
    if (this.viewState.selectedNodeId !== null) instance.select_node(this.viewState.selectedNodeId);
    await this.afterRender();
  }

  private requireInstance(): JsMind {
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
