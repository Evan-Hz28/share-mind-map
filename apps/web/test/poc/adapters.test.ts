import { afterEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../src/poc/adapters/index.js";
import { sampleDocument } from "../../src/poc/sample.js";
import type { CanvasCandidate, MindMapViewState } from "../../src/poc/types.js";
import { createCanvasHost } from "./helpers.js";

const candidates: CanvasCandidate[] = ["simple-mind-map", "mind-elixir", "jsmind"];

afterEach(() => {
  document.body.replaceChildren();
});

describe.each(candidates)("%s adapter", (candidate) => {
  it("round-trips stable IDs without leaking vendor fields", async () => {
    const host = createCanvasHost();
    const input = sampleDocument(100);
    const adapter = createAdapter(candidate, host);

    await adapter.mount(input);
    expect(host.childElementCount).toBeGreaterThan(0);
    const exported = adapter.exportSnapshot();
    expect(exported).toEqual(input);
    expect(JSON.stringify(exported)).not.toMatch(/mindElixir|simpleMindMap|jsMind/);

    adapter.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it("restores local view state across full snapshot replacement", async () => {
    const host = createCanvasHost();
    const initial = sampleDocument(100);
    const replacement = structuredClone(initial);
    const sheet = replacement.sheets[0];
    if (sheet === undefined) throw new Error("Expected the sample sheet.");
    const selectedNodeId = sheet.nodes[sheet.rootNodeId]?.childIds[1];
    if (selectedNodeId === undefined) throw new Error("Expected a selectable sample node.");
    const selectedNode = sheet.nodes[selectedNodeId];
    if (selectedNode === undefined) throw new Error("Expected the selected sample node.");
    selectedNode.title = "Replacement title";
    const wantedState: MindMapViewState = {
      selectedNodeId,
      expandedNodeIds: [sheet.rootNodeId, selectedNodeId],
      viewport: { x: 42, y: -18, zoom: 1.25 },
      readOnly: true,
    };
    const adapter = createAdapter(candidate, host);

    await adapter.mount(initial);
    await adapter.restoreViewState(wantedState);
    await adapter.applySnapshot(replacement);

    expect(adapter.getViewState()).toEqual(wantedState);
    expect(adapter.exportSnapshot()).toEqual(replacement);
    adapter.destroy();
  });
});
