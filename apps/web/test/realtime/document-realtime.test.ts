import { describe, expect, it, vi } from "vitest";

import { DocumentRealtime } from "../../src/realtime/document-realtime.js";
import { sampleDocument } from "../editor/test-fixtures.js";

function fakeSocket() {
  const listeners = new Map<string, (payload?: unknown) => void>();
  const socket = {
    connected: false,
    emit: vi.fn(),
    on: vi.fn(),
    disconnect: vi.fn(),
    fire(event: string, payload?: unknown): void {
      listeners.get(event)?.(payload);
    },
  };
  socket.emit.mockReturnValue(socket);
  socket.on.mockImplementation((event: string, listener: (payload?: unknown) => void) => {
    listeners.set(event, listener);
    return socket;
  });
  socket.disconnect.mockReturnValue(socket);
  return socket;
}

describe("DocumentRealtime", () => {
  it("filters stale versions, requests REST recovery on a gap, and rejoins without a lock request", () => {
    const socket = fakeSocket();
    const onVersionGap = vi.fn();
    const onReconnect = vi.fn();
    const snapshots: number[] = [];
    const realtime = new DocumentRealtime({
      baseUrl: "http://localhost:8080",
      socketFactory: () => socket,
      onVersionGap,
      onReconnect,
    });
    realtime.onSnapshot(({ version }) => snapshots.push(version));
    realtime.connect();
    socket.connected = true;
    socket.fire("connect");
    realtime.join("00000000-0000-7000-8000-000000000003", "00000000-0000-7000-8000-000000000101");

    const snapshot = sampleDocument();
    socket.fire("document:snapshot", { version: 1, snapshot });
    socket.fire("document:snapshot", { version: 1, snapshot });
    socket.fire("document:snapshot", { version: 3, snapshot: { ...snapshot, version: 3 } });

    expect(snapshots).toEqual([1]);
    expect(onVersionGap).toHaveBeenCalledWith(2, 3);
    expect(socket.emit).toHaveBeenCalledWith("document:join", {
      workspaceId: "00000000-0000-7000-8000-000000000003",
      documentId: "00000000-0000-7000-8000-000000000101",
    });

    socket.fire("connect");
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(socket.emit).not.toHaveBeenCalledWith("document:acquire-lock", expect.anything());
  });
});
