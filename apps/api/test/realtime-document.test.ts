import type { Socket } from "socket.io";
import { describe, expect, it, vi } from "vitest";

import { DocumentRoomService } from "../src/realtime/document-room.service.js";
import { WorkspaceRealtimeGateway } from "../src/realtime/workspace-realtime.gateway.js";

const workspaceId = "00000000-0000-7000-8000-000000000003";
const documentId = "00000000-0000-7000-8000-000000000101";

function socket(id: string, session = true): Socket {
  return {
    id,
    data: session
      ? {
          session: {
            userId: `user-${id}`,
            workspaceId,
            role: "editor",
          },
        }
      : {},
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
  } as unknown as Socket;
}

function database() {
  return {
    $client: {
      query: vi.fn().mockResolvedValue({ rows: [{ current_version: 4 }] }),
    },
  };
}

describe("document realtime rooms", () => {
  it("rejects unauthorized sockets, caps rooms at 100 members, cleans up, and broadcasts committed snapshots", async () => {
    const db = database();
    const rooms = new DocumentRoomService(db as never);
    const unauthorized = socket("unauthorized", false);
    await expect(rooms.join(unauthorized, workspaceId, documentId)).resolves.toEqual({
      mode: "denied",
      code: "UNAUTHORIZED",
    });

    const members = Array.from({ length: 100 }, (_, index) => socket(`member-${String(index)}`));
    for (const member of members) {
      await expect(rooms.join(member, workspaceId, documentId)).resolves.toEqual({
        mode: "joined",
        currentVersion: 4,
      });
    }
    await expect(rooms.join(socket("member-101"), workspaceId, documentId)).resolves.toEqual({
      mode: "rest",
      currentVersion: 4,
      reason: "ROOM_LIMIT",
    });

    const firstMember = members[0];
    if (firstMember === undefined) throw new Error("First room member is missing");
    await rooms.leave(firstMember, workspaceId, documentId);
    await expect(rooms.join(socket("member-101"), workspaceId, documentId)).resolves.toEqual({
      mode: "joined",
      currentVersion: 4,
    });

    const snapshot = {
      schemaVersion: 1,
      documentId,
      version: 5,
      sheets: [],
      extensions: {},
    } as never;
    rooms.broadcastSnapshot({
      workspaceId,
      documentId,
      snapshot,
      version: 5,
      browserEditSessionId: "browser-two",
    });
    const secondMember = members[1];
    if (secondMember === undefined) throw new Error("Second room member is missing");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(secondMember["emit"])).toHaveBeenCalledWith("document:snapshot", {
      version: 5,
      snapshot,
      browserEditSessionId: "browser-two",
    });
  });

  it("returns a document error for a gateway join without a session", async () => {
    const db = database();
    const rooms = new DocumentRoomService(db as never);
    const gateway = new WorkspaceRealtimeGateway(db as never, { get: vi.fn() }, rooms);
    const client = socket("unauthorized", false);
    await gateway.joinDocument(client, { workspaceId, documentId });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(client["emit"])).toHaveBeenCalledWith("document:error", {
      code: "UNAUTHORIZED",
      message: "Document room denied.",
    });
  });
});
