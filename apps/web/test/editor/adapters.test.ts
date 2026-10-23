/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { afterEach, describe, expect, it, vi } from "vitest";
import MindElixir from "mind-elixir";

import { MindElixirAdapter } from "../../src/editor/adapters/mind-elixir.js";
import { sampleDocument } from "../../src/poc/sample.js";
import { createCanvasHost } from "../poc/helpers.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("formal MindElixir adapter", () => {
  it("uses a centered two-sided layout without the native toolbar", async () => {
    const host = createCanvasHost();
    const adapter = new MindElixirAdapter(host);

    await adapter.mount(sampleDocument(31));

    const internals = adapter as unknown as {
      instance: {
        contextMenu: boolean;
        direction: number;
        keypress: boolean;
        overflowHidden: boolean;
        toolBar: boolean;
      };
    };
    expect(internals.instance.direction).toBe(MindElixir.SIDE);
    expect(internals.instance.contextMenu).toBe(true);
    expect(internals.instance.keypress).toBe(true);
    expect(internals.instance.overflowHidden).toBe(false);
    expect(internals.instance.toolBar).toBe(false);

    adapter.destroy();
  });

  it("adopts a saved snapshot without rebuilding the canvas", async () => {
    const host = createCanvasHost();
    const adapter = new MindElixirAdapter(host);

    await adapter.mount(sampleDocument(31));
    const rootBefore = host.querySelector(".me-root");

    adapter.acceptSavedSnapshot({ ...sampleDocument(31), version: 9 });

    expect(host.querySelector(".me-root")).toBe(rootBefore);
    expect(adapter.exportSnapshot().version).toBe(9);
    adapter.destroy();
  });

  it("tracks a child expansion from the MindElixir control", async () => {
    const host = createCanvasHost();
    const input = sampleDocument(31);
    const adapter = new MindElixirAdapter(host);

    await adapter.mount(input);

    const sheet = input.sheets[0]!;
    const childId = sheet.nodes[sheet.rootNodeId]!.childIds[0]!;
    const internals = adapter as unknown as {
      instance: {
        findEle(id: string, container?: HTMLElement): HTMLElement;
      };
    };
    const child = internals.instance.findEle(childId, host);
    const expandControl = child.closest(".me-wrapper")?.querySelector<HTMLElement>(".me-epd");
    expect(expandControl).not.toBeNull();

    expandControl!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(adapter.getViewState().expandedNodeIds).toContain(childId);
    expandControl!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(adapter.getViewState().expandedNodeIds).not.toContain(childId);
    adapter.destroy();
  });

  it("emits a validated standard snapshot on a vendor operation", async () => {
    const host = createCanvasHost();
    const input = sampleDocument(31);
    const adapter = new MindElixirAdapter(host);
    const changes: unknown[] = [];

    await adapter.mount(input);
    const unsubscribe = adapter.onChange((document) => changes.push(document));
    const internals = adapter as unknown as {
      instance: {
        bus: { fire(name: string, payload: unknown): void };
        getData(): { nodeData: unknown };
      };
    };

    internals.instance.bus.fire("operation", {
      name: "finishEdit",
      target: internals.instance.getData().nodeData,
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual(input);
    expect(JSON.stringify(changes[0])).not.toMatch(/mindElixir|simpleMindMap|jsMind/);

    unsubscribe();
    adapter.destroy();
  });

  it("restores persisted root branch directions", async () => {
    const input = sampleDocument(31);
    const sheet = input.sheets[0]!;
    const root = sheet.nodes[sheet.rootNodeId]!;
    const [firstId, secondId] = root.childIds;
    if (firstId === undefined || secondId === undefined) throw new Error("Expected two branches.");
    sheet.nodes[firstId]!.extensions = {
      "share-mind-map.layout": { direction: "left" },
    };
    sheet.nodes[secondId]!.extensions = {
      "share-mind-map.layout": { direction: "right" },
    };
    for (const [index, childId] of root.childIds.entries()) {
      const child = sheet.nodes[childId];
      if (child === undefined) throw new Error("Expected a root child.");
      child.extensions = {
        "share-mind-map.layout": { direction: index % 2 === 0 ? "left" : "right" },
      };
    }
    const host = createCanvasHost();
    const adapter = new MindElixirAdapter(host);

    await adapter.mount(input);

    const internals = adapter as unknown as {
      instance: { getData(): { nodeData: { children?: Array<{ direction?: number }> } } };
    };
    expect(internals.instance.getData().nodeData.children?.map((node) => node.direction)).toEqual([
      MindElixir.LEFT,
      MindElixir.RIGHT,
      MindElixir.LEFT,
      MindElixir.RIGHT,
    ]);

    adapter.destroy();
  });

  it("uses the XMind default root split when a legacy snapshot has no directions", async () => {
    const host = createCanvasHost();
    const adapter = new MindElixirAdapter(host);

    await adapter.mount(sampleDocument(31));

    const internals = adapter as unknown as {
      instance: { getData(): { nodeData: { children?: Array<{ direction?: number }> } } };
    };
    expect(internals.instance.getData().nodeData.children?.map((node) => node.direction)).toEqual([
      MindElixir.RIGHT,
      MindElixir.RIGHT,
      MindElixir.LEFT,
      MindElixir.LEFT,
    ]);

    adapter.destroy();
  });

  it("persists a changed root branch direction from the vendor snapshot", async () => {
    const host = createCanvasHost();
    const input = sampleDocument(31);
    const adapter = new MindElixirAdapter(host);
    const changes: unknown[] = [];

    await adapter.mount(input);
    adapter.onChange((document) => changes.push(document));
    const internals = adapter as unknown as {
      instance: {
        bus: { fire(name: string, payload: unknown): void };
        getData(): { nodeData: { children?: Array<{ direction?: number }> } };
        nodeData: { children?: Array<{ direction?: number }> };
      };
    };
    internals.instance.nodeData.children![0]!.direction = MindElixir.RIGHT;

    internals.instance.bus.fire("operation", {
      name: "moveNodesAfter",
      target: [internals.instance.getData().nodeData],
      destination: internals.instance.getData().nodeData,
    });

    const latest = changes.at(-1) as typeof input | undefined;
    expect(
      latest?.sheets[0]!.nodes[latest.sheets[0]!.nodes[latest.sheets[0]!.rootNodeId]!.childIds[0]!]!
        .extensions,
    ).toEqual({ "share-mind-map.layout": { direction: "right" } });

    await adapter.applySnapshot(latest!);
    expect(internals.instance.nodeData.children![0]!.direction).toBe(MindElixir.RIGHT);

    adapter.destroy();
  });

  it("does not emit a snapshot when a node only enters edit mode", async () => {
    const host = createCanvasHost();
    const input = sampleDocument(31);
    const adapter = new MindElixirAdapter(host);
    const changes: unknown[] = [];

    await adapter.mount(input);
    const unsubscribe = adapter.onChange((document) => changes.push(document));
    const internals = adapter as unknown as {
      instance: {
        bus: { fire(name: string, payload: unknown): void };
        getData(): { nodeData: unknown };
      };
    };

    internals.instance.bus.fire("operation", {
      name: "beginEdit",
      target: internals.instance.getData().nodeData,
    });

    expect(changes).toHaveLength(0);

    unsubscribe();
    adapter.destroy();
  });

  it("starts node editing with a caret instead of selecting the whole topic", async () => {
    const host = createCanvasHost();
    const inputDocument = sampleDocument(31);
    const adapter = new MindElixirAdapter(host);

    await adapter.mount(inputDocument);

    const childId =
      inputDocument.sheets[0]!.nodes[inputDocument.sheets[0]!.rootNodeId]!.childIds[0]!;
    const internals = adapter as unknown as {
      instance: {
        beginEdit(node: HTMLElement): void;
        findEle(id: string, container?: HTMLElement): HTMLElement;
      };
    };

    internals.instance.beginEdit(internals.instance.findEle(childId, host));

    const input = host.querySelector<HTMLElement>("#input-box");
    expect(input).not.toBeNull();
    expect(window.getSelection()?.isCollapsed).toBe(true);

    adapter.destroy();
  });

  it("expands and collapses all nodes without changing the document", async () => {
    const host = createCanvasHost();
    const input = sampleDocument(31);
    const adapter = new MindElixirAdapter(host);
    const changes: unknown[] = [];

    await adapter.mount(input);
    const unsubscribe = adapter.onChange((document) => changes.push(document));
    const internals = adapter as unknown as {
      instance: { scaleFit: () => void };
    };
    const fit = vi.spyOn(internals.instance, "scaleFit");
    const expectedExpandedIds = Object.values(input.sheets[0]!.nodes)
      .filter((node) => node.childIds.length > 0)
      .map((node) => node.id);

    await adapter.setAllExpanded(true);

    expect(adapter.getViewState().expandedNodeIds).toEqual(expectedExpandedIds);
    expect(changes).toHaveLength(0);

    await adapter.setAllExpanded(false);

    expect(adapter.getViewState().expandedNodeIds).toEqual([]);
    expect(changes).toHaveLength(0);
    expect(fit).toHaveBeenCalledTimes(2);

    unsubscribe();
    adapter.destroy();
  });

  it("delegates history and node commands to the selected MindElixir nodes", async () => {
    const host = createCanvasHost();
    const input = sampleDocument(31);
    const adapter = new MindElixirAdapter(host);
    const changes: unknown[] = [];

    await adapter.mount(input);
    adapter.onChange((document) => changes.push(document));

    const internals = adapter as unknown as {
      instance: {
        addChild: () => Promise<void>;
        currentNodes: HTMLElement[];
        findEle(id: string, container?: HTMLElement): HTMLElement;
        insertSibling: (type: "after") => Promise<void>;
        redo: () => void;
        removeNodes: (nodes: HTMLElement[]) => Promise<void>;
        selectNode(node: HTMLElement): void;
        undo: () => void;
      };
    };
    const childId = input.sheets[0]!.nodes[input.sheets[0]!.rootNodeId]!.childIds[0]!;
    internals.instance.selectNode(internals.instance.findEle(childId, host));

    const undo = vi.spyOn(internals.instance, "undo");
    const redo = vi.spyOn(internals.instance, "redo");
    adapter.undo();
    adapter.redo();
    expect(undo).toHaveBeenCalledOnce();
    expect(redo).toHaveBeenCalledOnce();

    await adapter.addChild();
    await adapter.addSibling();
    expect(changes.length).toBeGreaterThanOrEqual(2);

    await adapter.removeSelected();
    expect(changes.length).toBeGreaterThanOrEqual(3);
    adapter.destroy();
  });

  it("adds a child to a leaf node without crashing MindElixir's expansion path", async () => {
    const host = createCanvasHost();
    const input = sampleDocument(5);
    const adapter = new MindElixirAdapter(host);
    const changes: unknown[] = [];

    await adapter.mount(input);
    adapter.onChange((document) => changes.push(document));

    const internals = adapter as unknown as {
      instance: {
        findEle(id: string, container?: HTMLElement): HTMLElement;
        selectNode(node: HTMLElement): void;
      };
    };
    const sheet = input.sheets[0]!;
    const leafId = sheet.nodes[sheet.rootNodeId]!.childIds[0]!;
    internals.instance.selectNode(internals.instance.findEle(leafId, host));

    await adapter.addChild();

    const latest = changes.at(-1) as typeof input | undefined;
    expect(latest).toBeDefined();
    const nextSheet = latest!.sheets[0]!;
    const childId = nextSheet.nodes[leafId]!.childIds[0];
    expect(childId).toBeDefined();
    expect(nextSheet.nodes[childId!]).toMatchObject({
      parentId: leafId,
      title: "New Node",
    });
    expect(host.querySelector("#input-box")).not.toBeNull();

    adapter.destroy();
  });

  it("keeps layout and viewport commands out of the document save stream", async () => {
    const host = createCanvasHost();
    const adapter = new MindElixirAdapter(host);
    const onChange = vi.fn();

    await adapter.mount(sampleDocument(31));
    adapter.onChange(onChange);
    const internals = adapter as unknown as {
      instance: {
        initLeft: () => void;
        initRight: () => void;
        initSide: () => void;
        scaleFit: () => void;
      };
    };
    const left = vi.spyOn(internals.instance, "initLeft");
    const right = vi.spyOn(internals.instance, "initRight");
    const side = vi.spyOn(internals.instance, "initSide");
    const fit = vi.spyOn(internals.instance, "scaleFit");

    await adapter.setLayout("left");
    await adapter.setLayout("right");
    await adapter.setLayout("side");
    adapter.fitToView();
    adapter.zoomIn();
    adapter.zoomOut();

    expect(left).toHaveBeenCalledOnce();
    expect(right).toHaveBeenCalledOnce();
    expect(side).toHaveBeenCalledOnce();
    expect(fit).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    adapter.destroy();
  });

  it("allows panning beyond MindElixir's default content boundary", async () => {
    const host = createCanvasHost();
    const adapter = new MindElixirAdapter(host);
    await adapter.mount(sampleDocument(31));

    const internals = adapter as unknown as {
      instance: {
        map: HTMLElement;
        move(dx: number, dy: number): boolean;
      };
    };
    const before = internals.instance.map.style.transform;

    expect(internals.instance.move(0, 10_000)).toBe(true);
    expect(internals.instance.map.style.transform).not.toBe(before);
    expect(internals.instance.map.style.transform).toContain("10000px");

    adapter.destroy();
  });

  it("preserves view state and standard data across snapshot replacement", async () => {
    const host = createCanvasHost();
    const initial = sampleDocument(31);
    const replacement = structuredClone(initial);
    replacement.version = 2;
    replacement.sheets[0]!.nodes[replacement.sheets[0]!.rootNodeId]!.title = "Replacement";
    const adapter = new MindElixirAdapter(host);

    await adapter.mount(initial);
    await adapter.restoreViewState({
      selectedNodeId: replacement.sheets[0]!.rootNodeId,
      expandedNodeIds: [replacement.sheets[0]!.rootNodeId],
      viewport: { x: 42, y: -18, zoom: 1.25 },
      readOnly: true,
    });
    const state = adapter.getViewState();
    await adapter.applySnapshot(replacement);

    expect(adapter.getViewState()).toEqual(state);
    expect(adapter.exportSnapshot()).toEqual(replacement);
    adapter.destroy();
  });
});
