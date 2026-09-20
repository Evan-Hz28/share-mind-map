import { beforeEach, describe, expect, it } from "vitest";

import { DraftStore } from "../../src/editor/draft-store.js";
import { sampleDocument } from "./test-fixtures.js";

describe("DraftStore", () => {
  beforeEach(() => localStorage.clear());

  it("uses isolated deterministic keys and stores cloned snapshots without lock credentials", () => {
    const store = new DraftStore(localStorage);
    const firstKey = DraftStore.key("user-a", "workspace-a", "document-a");
    const secondKey = DraftStore.key("user-b", "workspace-a", "document-a");
    const snapshot = sampleDocument();

    store.save(firstKey, snapshot, { currentVersion: 4 });
    snapshot.sheets[0]!.nodes[snapshot.sheets[0]!.rootNodeId]!.title = "调用方修改";

    expect(firstKey).not.toBe(secondKey);
    expect(
      store.load(firstKey)?.snapshot.sheets[0]!.nodes[snapshot.sheets[0]!.rootNodeId]!.title,
    ).toBe("根节点");
    expect(store.load(secondKey)).toBeNull();
    expect(localStorage.getItem(firstKey)).not.toContain("lockToken");
    expect(localStorage.getItem(firstKey)).not.toContain("token");
  });

  it("copies JSON from a cloned draft and clears only the requested draft", () => {
    const store = new DraftStore(localStorage);
    const key = DraftStore.key("user-a", "workspace-a", "document-a");
    const otherKey = DraftStore.key("user-a", "workspace-a", "document-b");
    store.save(key, sampleDocument());
    store.save(otherKey, sampleDocument());

    const copied = JSON.parse(store.copyJson(key)) as { documentId: string };
    expect(copied.documentId).toBe("00000000-0000-7000-8000-000000000101");
    store.clear(key);
    expect(store.load(key)).toBeNull();
    expect(store.load(otherKey)).not.toBeNull();
  });
});
