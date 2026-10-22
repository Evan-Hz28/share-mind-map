import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { countDocumentNodes } from "../../document-model/src/invariants.js";
import { createInitialCloudDocument } from "../../document-model/src/initial-document.js";
import { migrateDatabase } from "../src/index.js";
import { DocumentRepository } from "../src/repositories/document.repository.js";
import { FolderRepository } from "../src/repositories/folder.repository.js";
import { normalizeEntityName } from "../src/repositories/name-normalization.js";
import { Phase2RepositoryError } from "../src/repositories/phase2.types.js";
import {
  type DatabaseTestRuntime,
  startDatabaseTestRuntime,
  stopDatabaseTestRuntime,
} from "./support.js";

let runtime: DatabaseTestRuntime;
let organizationId: string;
let workspaceId: string;
let otherWorkspaceId: string;
let userId: string;
const folders = new FolderRepository();
const documents = new DocumentRepository();

async function createFolder(
  name: string,
  targetWorkspaceId = workspaceId,
  parentId: string | null = null,
): Promise<string> {
  const normalized = normalizeEntityName(name, 50);
  return runtime.db.transaction(async (transaction) => {
    const folder = await folders.create(transaction, {
      workspaceId: targetWorkspaceId,
      parentId,
      name: normalized.displayName,
      nameNormalized: normalized.normalizedName,
      actorUserId: userId,
    });
    return folder.id;
  });
}

async function createDocument(name: string, folderId: string | null = null): Promise<string> {
  const normalized = normalizeEntityName(name, 100);
  const documentId = uuidv7();
  const snapshot = createInitialCloudDocument(documentId);
  return runtime.db.transaction(async (transaction) => {
    const document = await documents.createBlank(transaction, {
      documentId,
      workspaceId,
      folderId,
      name: normalized.displayName,
      nameNormalized: normalized.normalizedName,
      actorUserId: userId,
      snapshot,
      nodeCount: countDocumentNodes(snapshot),
    });
    return document.id;
  });
}

beforeAll(async () => {
  runtime = await startDatabaseTestRuntime();
  await migrateDatabase(runtime.db);
  organizationId = uuidv7();
  workspaceId = uuidv7();
  otherWorkspaceId = uuidv7();
  userId = uuidv7();
  await runtime.db.$client.query(
    `INSERT INTO organizations (id, name) VALUES ($1, 'Repository organization')`,
    [organizationId],
  );
  await runtime.db.$client.query(
    `INSERT INTO workspaces (id, organization_id, name) VALUES
      ($1, $3, 'Repository workspace'), ($2, $3, 'Other workspace')`,
    [workspaceId, otherWorkspaceId, organizationId],
  );
  await runtime.db.$client.query(
    `INSERT INTO users (id, display_name) VALUES ($1, 'Repository user')`,
    [userId],
  );
}, 120_000);

beforeEach(async () => {
  await runtime.db.$client.query("TRUNCATE document_snapshots, documents, folders CASCADE");
});

afterAll(async () => {
  await stopDatabaseTestRuntime(runtime);
});

describe("folder and document repositories", () => {
  it("creates, lists, renames and checks folders without deleting them", async () => {
    const folderId = await createFolder("  Design   Notes  ");
    const listed = await folders.list(runtime.db, workspaceId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("Design Notes");

    const renamed = await runtime.db.transaction((transaction) =>
      folders.rename(transaction, {
        workspaceId,
        folderId,
        name: "Renamed",
        nameNormalized: "renamed",
        actorUserId: userId,
      }),
    );
    expect(renamed.name).toBe("Renamed");
    const checked = await runtime.db.transaction((transaction) =>
      folders.checkDelete(transaction, workspaceId, folderId),
    );
    expect(checked.canDelete).toBe(true);
    expect(checked.documentCount).toBe(0);
  });

  it("creates an atomic blank snapshot and exposes stable cursor pages", async () => {
    const first = await createDocument("First");
    await createDocument("Second");
    const page = await documents.list(runtime.db, {
      workspaceId,
      sort: "name",
      limit: 1,
      cursor: null,
    });
    expect(page.documents).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = await documents.list(runtime.db, {
      workspaceId,
      sort: "name",
      limit: 1,
      cursor: page.nextCursor,
    });
    expect(next.documents).toHaveLength(1);
    expect(next.documents[0]?.id).not.toBe(first);
    const detail = await documents.findDetail(runtime.db, workspaceId, first);
    expect(detail?.snapshot).toMatchObject({ version: 1, documentId: first });
  });

  it("rolls back the document and snapshot together", async () => {
    const documentId = uuidv7();
    const snapshot = createInitialCloudDocument(documentId);
    await expect(
      runtime.db.transaction(async (transaction) => {
        await documents.createBlank(transaction, {
          documentId,
          workspaceId,
          folderId: null,
          name: "Rolled back",
          nameNormalized: "rolled back",
          actorUserId: userId,
          snapshot,
          nodeCount: countDocumentNodes(snapshot),
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await documents.findDetail(runtime.db, workspaceId, documentId)).toBeNull();
  });

  it("hard deletes a folder and its documents and allows recreating the name", async () => {
    const folderId = await createFolder("Archive");
    const first = await createDocument("First", folderId);
    const second = await createDocument("Second", folderId);
    const detached = await createDocument("Detached");

    const result = await runtime.db.transaction((transaction) =>
      folders.deleteWithDocuments(transaction, {
        workspaceId,
        folderId,
        expectedDocumentCount: 2,
      }),
    );
    expect(result.documentCount).toBe(2);
    expect(result.documentIds.sort()).toEqual([first, second].sort());
    expect(await folders.list(runtime.db, workspaceId)).toHaveLength(0);
    expect(await documents.findDetail(runtime.db, workspaceId, first)).toBeNull();
    expect(await documents.findDetail(runtime.db, workspaceId, second)).toBeNull();
    expect(await documents.findDetail(runtime.db, workspaceId, detached)).not.toBeNull();

    const recreated = await createFolder("Archive");
    expect(recreated).not.toBe(folderId);
  });

  it("blocks deletion during active imports and rejects stale document counts", async () => {
    const folderId = await createFolder("Imports");
    await createDocument("Inside", folderId);

    await expect(
      runtime.db.transaction((transaction) =>
        folders.deleteWithDocuments(transaction, {
          workspaceId,
          folderId,
          expectedDocumentCount: 0,
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_DELETE_CONFLICT" });

    const batchId = uuidv7();
    await runtime.db.$client.query(
      `INSERT INTO import_batches (id, workspace_id, requested_by, total_jobs)
       VALUES ($1, $2, $3, 1)`,
      [batchId, workspaceId, userId],
    );
    await runtime.db.$client.query(
      `INSERT INTO import_jobs
         (id, batch_id, workspace_id, requested_by, target_folder_id,
          client_file_name, target_name, target_name_normalized, phase)
       VALUES ($1, $2, $3, $4, $5, 'inside.xmind', 'Inside', 'inside', 'parsing')`,
      [uuidv7(), batchId, workspaceId, userId, folderId],
    );

    await expect(
      runtime.db.transaction((transaction) =>
        folders.deleteWithDocuments(transaction, {
          workspaceId,
          folderId,
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_DELETE_BLOCKED" });

    await runtime.db.$client.query(
      `UPDATE import_jobs SET phase = 'succeeded' WHERE batch_id = $1`,
      [batchId],
    );
    const result = await runtime.db.transaction((transaction) =>
      folders.deleteWithDocuments(transaction, {
        workspaceId,
        folderId,
      }),
    );
    expect(result.documentCount).toBe(1);
    const job = await runtime.db.$client.query<{ target_folder_id: string | null }>(
      `SELECT target_folder_id FROM import_jobs WHERE batch_id = $1`,
      [batchId],
    );
    expect(job.rows[0]?.target_folder_id).toBeNull();
  });

  it("persists a custom folder order and appends new folders after it", async () => {
    const beta = await createFolder("Beta");
    const alpha = await createFolder("Alpha");
    const gamma = await createFolder("Gamma");
    // 新建文件夹排在末尾,不再退回按名称排序。
    expect((await folders.list(runtime.db, workspaceId)).map((folder) => folder.id)).toEqual([
      beta,
      alpha,
      gamma,
    ]);

    const order = [gamma, alpha, beta];
    const count = await runtime.db.transaction((transaction) =>
      folders.reorder(transaction, {
        workspaceId,
        parentId: null,
        folderIds: order,
        actorUserId: userId,
      }),
    );
    expect(count).toBe(3);
    expect((await folders.list(runtime.db, workspaceId)).map((folder) => folder.id)).toEqual(order);

    const delta = await createFolder("Delta");
    expect((await folders.list(runtime.db, workspaceId)).map((folder) => folder.id)).toEqual([
      ...order,
      delta,
    ]);
  });

  it("rejects folder orders that do not match the current folder set", async () => {
    const alpha = await createFolder("Alpha");
    const beta = await createFolder("Beta");
    const foreign = await createFolder("Foreign", otherWorkspaceId);

    await expect(
      runtime.db.transaction((transaction) =>
        folders.reorder(transaction, {
          workspaceId,
          parentId: null,
          folderIds: [alpha],
          actorUserId: userId,
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_ORDER_CONFLICT" });

    await expect(
      runtime.db.transaction((transaction) =>
        folders.reorder(transaction, {
          workspaceId,
          parentId: null,
          folderIds: [alpha, alpha],
          actorUserId: userId,
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_ORDER_CONFLICT" });

    await expect(
      runtime.db.transaction((transaction) =>
        folders.reorder(transaction, {
          workspaceId,
          parentId: null,
          folderIds: [alpha, foreign],
          actorUserId: userId,
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_ORDER_CONFLICT" });

    expect((await folders.list(runtime.db, workspaceId)).map((folder) => folder.id)).toEqual([
      alpha,
      beta,
    ]);
  });

  it("nests folders and only enforces sibling name uniqueness", async () => {
    const root = await createFolder("Root");
    const otherRoot = await createFolder("Other Root");
    const child = await createFolder("Child", workspaceId, root);
    const sameName = await createFolder("Child", workspaceId, otherRoot);
    expect(sameName).not.toBe(child);

    const listed = await folders.list(runtime.db, workspaceId);
    expect(listed.find((folder) => folder.id === child)?.parentId).toBe(root);
    expect(listed.find((folder) => folder.id === sameName)?.parentId).toBe(otherRoot);
    expect(listed.find((folder) => folder.id === root)?.parentId).toBeNull();

    await expect(createFolder("Child", workspaceId, root)).rejects.toMatchObject({
      cause: { code: "23505" },
    });
  });

  it("enforces the folder depth limit", async () => {
    let parentId: string | null = null;
    for (let level = 1; level <= 8; level += 1) {
      parentId = await createFolder(`Level ${String(level)}`, workspaceId, parentId);
    }
    await expect(createFolder("Level 9", workspaceId, parentId)).rejects.toMatchObject({
      code: "FOLDER_DEPTH_EXCEEDED",
    });
  });

  it("reorders siblings and moves folders without creating cycles", async () => {
    const root = await createFolder("Root");
    const other = await createFolder("Other");
    const child = await createFolder("Child", workspaceId, root);
    const sibling = await createFolder("Sibling", workspaceId, root);

    const count = await runtime.db.transaction((transaction) =>
      folders.reorder(transaction, {
        workspaceId,
        parentId: root,
        folderIds: [sibling, child],
        actorUserId: userId,
      }),
    );
    expect(count).toBe(2);
    const children = (await folders.list(runtime.db, workspaceId)).filter(
      (folder) => folder.parentId === root,
    );
    expect(children.map((folder) => folder.id)).toEqual([sibling, child]);

    await expect(
      runtime.db.transaction((transaction) =>
        folders.reorder(transaction, {
          workspaceId,
          parentId: null,
          folderIds: [sibling, child],
          actorUserId: userId,
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_ORDER_CONFLICT" });

    const moved = await runtime.db.transaction((transaction) =>
      folders.move(transaction, {
        workspaceId,
        folderId: other,
        parentId: child,
        actorUserId: userId,
      }),
    );
    expect(moved.parentId).toBe(child);

    await expect(
      runtime.db.transaction((transaction) =>
        folders.move(transaction, {
          workspaceId,
          folderId: child,
          parentId: other,
          actorUserId: userId,
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_MOVE_CYCLE" });

    await expect(
      runtime.db.transaction((transaction) =>
        folders.move(transaction, {
          workspaceId,
          folderId: child,
          parentId: child,
          actorUserId: userId,
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_MOVE_CYCLE" });

    const detached = await runtime.db.transaction((transaction) =>
      folders.move(transaction, {
        workspaceId,
        folderId: other,
        parentId: null,
        actorUserId: userId,
      }),
    );
    expect(detached.parentId).toBeNull();
  });

  it("deletes a folder subtree with all documents and detaches import jobs", async () => {
    const root = await createFolder("Root");
    const child = await createFolder("Child", workspaceId, root);
    const grandchild = await createFolder("Grandchild", workspaceId, child);
    const rootDocument = await createDocument("Root document", root);
    const childDocument = await createDocument("Child document", child);
    const grandchildDocument = await createDocument("Grandchild document", grandchild);
    const outside = await createDocument("Outside");

    const checked = await runtime.db.transaction((transaction) =>
      folders.checkDelete(transaction, workspaceId, root),
    );
    expect(checked.documentCount).toBe(3);
    expect(checked.descendantFolderCount).toBe(2);

    const batchId = uuidv7();
    await runtime.db.$client.query(
      `INSERT INTO import_batches (id, workspace_id, requested_by, total_jobs)
       VALUES ($1, $2, $3, 1)`,
      [batchId, workspaceId, userId],
    );
    await runtime.db.$client.query(
      `INSERT INTO import_jobs
         (id, batch_id, workspace_id, requested_by, target_folder_id,
          client_file_name, target_name, target_name_normalized, phase)
       VALUES ($1, $2, $3, $4, $5, 'grand.xmind', 'Grand', 'grand', 'parsing')`,
      [uuidv7(), batchId, workspaceId, userId, grandchild],
    );
    await expect(
      runtime.db.transaction((transaction) =>
        folders.deleteWithDocuments(transaction, { workspaceId, folderId: root }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_DELETE_BLOCKED" });

    await runtime.db.$client.query(
      `UPDATE import_jobs SET phase = 'succeeded' WHERE batch_id = $1`,
      [batchId],
    );
    const result = await runtime.db.transaction((transaction) =>
      folders.deleteWithDocuments(transaction, {
        workspaceId,
        folderId: root,
        expectedDocumentCount: 3,
      }),
    );
    expect(result.folderIds.sort()).toEqual([root, child, grandchild].sort());
    expect(result.documentCount).toBe(3);
    expect(await folders.list(runtime.db, workspaceId)).toHaveLength(0);
    for (const documentId of [rootDocument, childDocument, grandchildDocument]) {
      expect(await documents.findDetail(runtime.db, workspaceId, documentId)).toBeNull();
    }
    expect(await documents.findDetail(runtime.db, workspaceId, outside)).not.toBeNull();
    const job = await runtime.db.$client.query<{ target_folder_id: string | null }>(
      `SELECT target_folder_id FROM import_jobs WHERE batch_id = $1`,
      [batchId],
    );
    expect(job.rows[0]?.target_folder_id).toBeNull();
  });

  it("rejects cross-workspace folders and enforces folder limits", async () => {
    const foreignFolderId = await createFolder("Foreign", otherWorkspaceId);
    await expect(
      runtime.db.transaction((transaction) =>
        documents.move(transaction, {
          workspaceId,
          documentId: uuidv7(),
          folderId: foreignFolderId,
          actorUserId: userId,
        }),
      ),
    ).rejects.toMatchObject({
      code: "FOLDER_NOT_IN_WORKSPACE",
    } satisfies Partial<Phase2RepositoryError>);

    await runtime.db.$client.query(
      `INSERT INTO folders (id, workspace_id, name, name_normalized, created_by, updated_by)
       SELECT md5('limit-folder-' || n::text)::uuid, $1, 'Folder ' || n::text,
              'folder-' || n::text, $2, $2 FROM generate_series(1, 500) AS n`,
      [workspaceId, userId],
    );
    await expect(createFolder("Over limit")).rejects.toMatchObject({
      code: "FOLDER_LIMIT_REACHED",
    });
  });
});
