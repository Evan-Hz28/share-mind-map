import { beforeEach, describe, expect, it, vi } from "vitest";

import { SaveQueue } from "../../src/editor/save-queue.js";
import { sampleDocument } from "./test-fixtures.js";

describe("SaveQueue", () => {
  beforeEach(() => vi.useFakeTimers());

  it("coalesces autosaves and sends the newest cloned snapshot", async () => {
    const save = vi.fn().mockResolvedValue({ version: 2 });
    const queue = new SaveQueue(save, { debounceMs: 100 });
    const first = sampleDocument();
    const second = sampleDocument();
    second.sheets[0]!.nodes[first.sheets[0]!.rootNodeId]!.title = "最新草稿";

    const firstResult = queue.enqueue(first, "auto");
    const secondResult = queue.enqueue(second, "auto");
    second.sheets[0]!.nodes[first.sheets[0]!.rootNodeId]!.title = "调用方后续修改";

    await vi.advanceTimersByTimeAsync(100);
    await expect(firstResult).resolves.toEqual({ version: 2 });
    await expect(secondResult).resolves.toEqual({ version: 2 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        sheets: [
          expect.objectContaining({
            nodes: expect.objectContaining({
              [first.sheets[0]!.rootNodeId]: expect.objectContaining({ title: "最新草稿" }),
            }),
          }),
        ],
      }),
      "auto",
    );
  });

  it("serializes manual saves and flushes a pending autosave", async () => {
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const save = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstStarted;
        return { version: 2 };
      })
      .mockResolvedValue({ version: 3 });
    const queue = new SaveQueue(save, { debounceMs: 100 });

    const auto = queue.enqueue(sampleDocument(), "auto");
    await vi.advanceTimersByTimeAsync(100);
    const manual = queue.enqueue(sampleDocument(), "manual");
    expect(save).toHaveBeenCalledTimes(1);
    releaseFirst();
    await expect(auto).resolves.toEqual({ version: 2 });
    await expect(manual).resolves.toEqual({ version: 3 });
    expect(save).toHaveBeenCalledTimes(2);
  });
});
