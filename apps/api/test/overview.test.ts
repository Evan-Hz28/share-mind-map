import type { Database } from "@share-mind-map/database";
import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../src/auth/auth-context.js";
import { OverviewService } from "../src/overview/overview.service.js";

const workspaceId = "00000000-0000-7000-8000-000000000003";

function context(role: "reader" | "editor" | "admin", sessionWorkspaceId = workspaceId): AuthContext {
  return {
    session: {
      userId: "00000000-0000-7000-8000-000000000001",
      workspaceId: sessionWorkspaceId,
      role,
      mustChangePassword: false,
      csrfDigest: "digest",
    },
    sessionToken: "token",
  };
}

function serviceWith(row: Record<string, unknown>) {
  const query = vi.fn().mockResolvedValue({ rows: [row] });
  return {
    query,
    service: new OverviewService({ $client: { query } } as unknown as Database),
  };
}

describe("workspace overview", () => {
  it("maps the aggregate row and returns a plain number for the node count", async () => {
    const { service, query } = serviceWith({
      folder_count: 4,
      document_count: 12,
      node_count: "1500",
      active_import_jobs: 2,
      pending_edit_requests: 3,
    });

    await expect(service.read(context("admin"), workspaceId)).resolves.toEqual({
      workspaceId,
      folderCount: 4,
      documentCount: 12,
      nodeCount: 1500,
      activeImportJobs: 2,
      pendingEditRequests: 3,
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), [workspaceId, true]);
  });

  it("does not count approval requests for non-administrators", async () => {
    const { service, query } = serviceWith({
      folder_count: 0,
      document_count: 0,
      node_count: "0",
      active_import_jobs: 0,
      pending_edit_requests: 0,
    });

    await service.read(context("reader"), workspaceId);

    expect(query).toHaveBeenCalledWith(expect.any(String), [workspaceId, false]);
  });

  it("rejects a workspace outside the session", async () => {
    const { service } = serviceWith({});

    await expect(
      service.read(context("admin", "00000000-0000-7000-8000-000000000099"), workspaceId),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
