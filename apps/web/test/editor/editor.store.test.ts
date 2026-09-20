import { createInitialCloudDocument } from "@share-mind-map/document-model";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../../src/editor/editor.store.js";

const documentId = "00000000-0000-7000-8000-000000000101";

describe("EditorStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts read-only, preserves a cloned draft, and exposes explicit editing transitions", () => {
    const editor = useEditorStore();
    const snapshot = createInitialCloudDocument(documentId);

    expect(editor.mode).toBe("readonly");
    expect(editor.canWrite).toBe(false);
    editor.startEditing(snapshot.version);
    expect(editor.mode).toBe("editing-clean");
    expect(editor.canWrite).toBe(true);

    const changed = structuredClone(snapshot);
    changed.sheets[0]!.nodes[changed.sheets[0]!.rootNodeId]!.title = "Changed";
    editor.markChanged(changed);
    expect(editor.mode).toBe("editing-dirty");
    expect(editor.dirty).toBe(true);
    expect(editor.draft).not.toBe(changed);
    expect(editor.draft?.sheets[0]?.nodes[changed.sheets[0]!.rootNodeId]?.title).toBe("Changed");

    editor.stopEditing();
    expect(editor.mode).toBe("readonly");
    expect(editor.canWrite).toBe(false);
    editor.discardDraft();
    expect(editor.draft).toBeNull();
    expect(editor.dirty).toBe(false);
  });
});
