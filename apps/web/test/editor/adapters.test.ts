/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { afterEach, describe, expect, it } from "vitest";

import { MindElixirAdapter } from "../../src/editor/adapters/mind-elixir.js";
import { sampleDocument } from "../../src/poc/sample.js";
import { createCanvasHost } from "../poc/helpers.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("formal MindElixir adapter", () => {
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
