import { describe, expect, it, vi } from "vitest";

import { NotificationOutboxProcessor } from "../src/notification-outbox.processor.js";

describe("NotificationOutboxProcessor", () => {
  it("materializes every ready event exactly once per worker batch", async () => {
    const repository = {
      readyBatch: vi.fn().mockResolvedValue(["event-1", "event-2"]),
      materializeOutboxEvent: vi.fn().mockResolvedValue(true),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new NotificationOutboxProcessor({} as never, repository);

    await expect(processor.processBatch(10)).resolves.toEqual({
      attempted: 2,
      delivered: 2,
      failed: 0,
    });
    expect(repository.materializeOutboxEvent).toHaveBeenCalledTimes(2);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("marks failed events for retry without stopping the batch", async () => {
    const repository = {
      readyBatch: vi.fn().mockResolvedValue(["event-1", "event-2"]),
      materializeOutboxEvent: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValueOnce(true),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new NotificationOutboxProcessor({} as never, repository);

    await expect(processor.processBatch()).resolves.toEqual({
      attempted: 2,
      delivered: 1,
      failed: 1,
    });
    expect(repository.markFailed).toHaveBeenCalledWith(expect.anything(), "event-1");
  });
});
