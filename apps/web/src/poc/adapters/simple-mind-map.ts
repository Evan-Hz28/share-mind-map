import type { CloudDocumentV1, CloudNodeV1, CloudSheetV1 } from "@share-mind-map/document-model";
import SimpleMindMap from "simple-mind-map";

import {
  cloneDocument,
  cloneViewState,
  INITIAL_VIEW_STATE,
  type MindMapAdapter,
  type MindMapViewState,
} from "../types.js";

type SimpleNode = {
  data: Record<string, unknown> & { uid: string; text: string; expand: boolean };
  children: SimpleNode[];
};

function toSimpleNode(
  sheet: CloudSheetV1,
  node: CloudNodeV1,
  expanded: ReadonlySet<string>,
): SimpleNode {
  return {
    data: {
      uid: node.id,
      text: node.title,
      expand: node.parentId === null || expanded.has(node.id),
      ...(node.labels.length > 0 ? { tag: [...node.labels] } : {}),
      ...(node.icons.length > 0 ? { icon: [...node.icons] } : {}),
      ...(node.notes === null ? {} : { note: node.notes.text }),
      ...node.style,
    },
    children: node.childIds.map((childId) => {
      const child = sheet.nodes[childId];
      if (child === undefined) throw new Error(`Missing child node ${childId}.`);
      return toSimpleNode(sheet, child, expanded);
    }),
  };
}

export class SimpleMindMapAdapter implements MindMapAdapter {
  private instance: SimpleMindMap | null = null;
  private snapshot: CloudDocumentV1 | null = null;
  private viewState = cloneViewState(INITIAL_VIEW_STATE);

  public constructor(private readonly host: HTMLElement) {}

  public async mount(document: CloudDocumentV1): Promise<void> {
    this.destroy();
    this.snapshot = cloneDocument(document);
    const sheet = this.requireSheet();
    const root = this.requireNode(sheet, sheet.rootNodeId);
    this.instance = new SimpleMindMap({
      el: this.host,
      data: toSimpleNode(sheet, root, new Set(this.viewState.expandedNodeIds)),
      readonly: this.viewState.readOnly,
      fit: false,
      openPerformance: true,
    });
    await this.waitForRender();
    await this.applyViewControls();
  }

  public async applySnapshot(document: CloudDocumentV1): Promise<void> {
    const instance = this.requireInstance();
    this.snapshot = cloneDocument(document);
    const sheet = this.requireSheet();
    await this.waitForRender(() => {
      instance.setData(
        toSimpleNode(
          sheet,
          this.requireNode(sheet, sheet.rootNodeId),
          new Set(this.viewState.expandedNodeIds),
        ),
      );
    });
    await this.applyViewControls();
  }

  public exportSnapshot(): CloudDocumentV1 {
    if (this.snapshot === null) throw new Error("The adapter is not mounted.");
    void this.requireInstance().getData();
    return cloneDocument(this.snapshot);
  }

  public async focusNode(nodeId: string): Promise<boolean> {
    const instance = this.requireInstance();
    const sheet = this.requireSheet();
    if (sheet.nodes[nodeId] === undefined) return false;
    await new Promise<void>((resolve) => {
      instance.renderer.goTargetNode(nodeId, resolve);
    });
    this.viewState.selectedNodeId = nodeId;
    await this.afterRender();
    return true;
  }

  public getViewState(): MindMapViewState {
    return cloneViewState(this.viewState);
  }

  public async restoreViewState(state: MindMapViewState): Promise<void> {
    this.viewState = cloneViewState(state);
    const instance = this.requireInstance();
    const sheet = this.requireSheet();
    await this.waitForRender(() => {
      instance.setData(
        toSimpleNode(
          sheet,
          this.requireNode(sheet, sheet.rootNodeId),
          new Set(this.viewState.expandedNodeIds),
        ),
      );
    });
    await this.applyViewControls();
  }

  public setReadOnly(readOnly: boolean): void {
    this.viewState.readOnly = readOnly;
    this.requireInstance().setMode(readOnly ? "readonly" : "edit");
  }

  public destroy(): void {
    this.instance?.destroy();
    this.instance = null;
    this.snapshot = null;
    this.host.replaceChildren();
  }

  private async applyViewControls(): Promise<void> {
    const instance = this.requireInstance();
    instance.setMode(this.viewState.readOnly ? "readonly" : "edit");
    const current = instance.view.getTransformData().state;
    instance.view.setScale(this.viewState.viewport.zoom);
    instance.view.translateXY(
      this.viewState.viewport.x - current.x,
      this.viewState.viewport.y - current.y,
    );
    if (this.viewState.selectedNodeId !== null) {
      const node = instance.renderer.findNodeByUid(this.viewState.selectedNodeId);
      if (node !== null && node !== undefined) {
        if (!this.viewState.readOnly) instance.execCommand("SET_NODE_ACTIVE", node, true);
        instance.renderer.moveNodeToCenter(node, false);
      }
    }
    await this.afterRender();
  }

  private requireInstance(): SimpleMindMap {
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

  private async waitForRender(action?: () => void): Promise<void> {
    const instance = this.requireInstance();
    await new Promise<void>((resolve) => {
      const onRenderEnd = (): void => {
        instance.off("node_tree_render_end", onRenderEnd);
        resolve();
      };
      instance.on("node_tree_render_end", onRenderEnd);
      action?.();
    });
  }
}
