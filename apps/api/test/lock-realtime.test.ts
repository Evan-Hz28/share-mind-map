import { describe, expect, it, vi } from "vitest";

import { LockService } from "../src/locks/lock.service.js";

const workspaceId = "00000000-0000-7000-8000-000000000003";
const documentId = "00000000-0000-7000-8000-000000000101";

describe("LockService realtime notifications", () => {
  it("broadcasts the new generation after an administrator force release", async () => {
    const broadcastLock = vi.fn();
    const transaction = {
      execute: vi.fn().mockResolvedValue({ rows: [{ organization_id: "org-1" }] }),
    };
    const service = Object.create(LockService.prototype) as LockService & Record<string, unknown>;
    const fields = service as unknown as Record<string, unknown>;
    fields.database = {
      $client: {
        query: vi.fn().mockResolvedValue({ rows: [{ id: documentId }] }),
      },
      transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    };
    fields.locks = {
      forceRelease: vi.fn().mockResolvedValue({ status: "released", generation: 2 }),
      inspect: vi.fn().mockResolvedValue({ occupied: false, generation: 2, ttlSeconds: 900 }),
    };
    fields.audits = { append: vi.fn().mockResolvedValue(undefined) };
    fields.documentRooms = { broadcastLock };

    await service.forceRelease(
      {
        session: {
          userId: "user-1",
          workspaceId,
          role: "admin",
          mustChangePassword: false,
          csrfDigest: "csrf-digest",
        },
        sessionToken: "session-token",
      } as never,
      workspaceId,
      documentId,
      { confirm: true },
      "request-1",
    );

    expect(broadcastLock).toHaveBeenCalledTimes(1);
    const event = broadcastLock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(event).toMatchObject({
      workspaceId,
      documentId,
      occupied: false,
      editorDisplayName: null,
      generation: 2,
    });
    expect(typeof event?.expiresAt).toBe("string");
  });
});
