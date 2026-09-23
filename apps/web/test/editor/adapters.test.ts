/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { afterEach, describe, expect, it } from "vitest";
import MindElixir from "mind-elixir";

import { MindElixirAdapter } from "../../src/editor/adapters/mind-elixir.js";
import { sampleDocument } from "../../src/poc/sample.js";
import { createCanvasHost } from "../poc/helpers.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("formal MindElixir adapter", () => {
  it("uses a centered two-sided layout for the formal document page", async () => {
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
    expect(internals.instance.toolBar).toBe(true);

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

    const childId = inputDocument.sheets[0]!.nodes[inputDocument.sheets[0]!.rootNodeId]!
      .childIds[0]!;
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
    const expectedExpandedIds = Object.values(input.sheets[0]!.nodes)
      .filter((node) => node.childIds.length > 0)
      .map((node) => node.id);

    await adapter.setAllExpanded(true);

    expect(adapter.getViewState().expandedNodeIds).toEqual(expectedExpandedIds);
    expect(changes).toHaveLength(0);

    await adapter.setAllExpanded(false);

    expect(adapter.getViewState().expandedNodeIds).toEqual([]);
    expect(changes).toHaveLength(0);

    unsubscribe();
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
