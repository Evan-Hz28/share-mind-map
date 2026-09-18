import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const socketState = vi.hoisted(() => ({
  listeners: new Map<string, (payload?: unknown) => void>(),
  emit: vi.fn(),
  removeAllListeners: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn((event: string, listener: (payload?: unknown) => void) => {
      socketState.listeners.set(event, listener);
    }),
    emit: socketState.emit,
    removeAllListeners: socketState.removeAllListeners,
    disconnect: socketState.disconnect,
  })),
}));

import { io } from "socket.io-client";

import { useWorkspaceStore } from "../src/workspace/workspace.store.js";

describe("workspace import realtime progress", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    socketState.listeners.clear();
  });

  it("subscribes by batch and applies safe progress payloads", () => {
    const store = useWorkspaceStore();
    const batchId = "01a0b3a0-0000-7000-8000-000000000001";

    store.connectImportRealtime(batchId);
    expect(io).toHaveBeenCalledWith(
      expect.stringMatching(/^https?:\/\/[^/]+\/workspace$/u),
      expect.objectContaining({ path: "/socket.io", withCredentials: true }),
    );
    socketState.listeners.get("connect")?.();
    expect(socketState.emit).toHaveBeenCalledWith("import:subscribe", { batchId });

    socketState.listeners.get("import:progress")?.({
      id: batchId,
      status: "processing",
      total_jobs: 2,
      succeeded_jobs: 1,
      failed_jobs: 0,
      cancelled_jobs: 0,
    });
    expect(store.importProgress).toEqual({
      status: "processing",
      totalJobs: 2,
      succeededJobs: 1,
      failedJobs: 0,
      cancelledJobs: 0,
    });
  });

  it("closes the previous socket when the import dialog is reset", () => {
    const store = useWorkspaceStore();
    store.connectImportRealtime("01a0b3a0-0000-7000-8000-000000000002");
    socketState.removeAllListeners.mockClear();
    socketState.disconnect.mockClear();
    store.closeImportRealtime();

    expect(socketState.removeAllListeners).toHaveBeenCalledOnce();
    expect(socketState.disconnect).toHaveBeenCalledOnce();
  });
});
