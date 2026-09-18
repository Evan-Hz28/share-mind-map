import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import {
  AuditRepository,
  DocumentRepository,
  ImportRepository,
  type Database,
  newId,
} from "@share-mind-map/database";
import { countDocumentNodes } from "@share-mind-map/document-model";
import {
  convertXMindToCloudDocument,
  extractXMindAssets,
  inspectXMindFile,
  XMindError,
  type CompatibilityIssue,
} from "@share-mind-map/xmind";
import { createMemoryReadable, type ObjectStorage } from "@share-mind-map/storage";
import { sql } from "drizzle-orm";

const SNAPSHOT_OBJECT_THRESHOLD = 1024 * 1024;
const IMPORT_TIMEOUT_MS = 5 * 60 * 1000;

class ImportDeadlineError extends Error {
  public constructor() {
    super("Import task timed out.");
    this.name = "ImportDeadlineError";
  }
}

export interface ProductionImportJob {
  jobId: string;
  batchId: string;
  workspaceId: string;
}

function compatibilityStatus(
  issues: CompatibilityIssue[],
): "full" | "partial" | "unsupported_online" {
  if (issues.some((issue) => issue.disposition === "rejected")) return "unsupported_online";
  return issues.length === 0 ? "full" : "partial";
}

function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof ImportDeadlineError)
    return { code: "IMPORT_TIMEOUT", message: "导入任务处理超时。" };
  if (error instanceof XMindError) return { code: error.code, message: "XMind 文件无法安全导入。" };
  return { code: "IMPORT_FAILED", message: "导入处理失败。" };
}

async function downloadToTemp(
  storage: ObjectStorage,
  objectKey: string,
): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "smm-import-"));
  const path = join(directory, "input.xmind");
  const stream = await storage.getStream(objectKey);
  await pipeline(stream, createWriteStream(path));
  return { directory, path };
}

export async function processProductionImport(
  job: ProductionImportJob,
  dependencies: { database: Database; storage: ObjectStorage; deadline?: number },
): Promise<void> {
  const deadline = dependencies.deadline ?? Date.now() + IMPORT_TIMEOUT_MS;
  const ensureWithinDeadline = () => {
    if (Date.now() >= deadline) throw new ImportDeadlineError();
  };
  const imports = new ImportRepository();
  const documents = new DocumentRepository();
  const audits = new AuditRepository();
  const current = await imports.findJob(dependencies.database, job.jobId);
  if (
    current === null ||
    current.batchId !== job.batchId ||
    current.workspaceId !== job.workspaceId
  )
    return;
  if (current.phase === "succeeded" || current.phase === "cancelled" || current.phase === "failed")
    return;
  if (current.tempObjectKey === null)
    return fail(dependencies.database, imports, current.id, "UPLOAD_MISSING", "导入文件不存在。");

  if (current.phase === "persisting" && current.documentId !== null) {
    const existing = await dependencies.database.$client.query<{ id: string }>(
      "SELECT id FROM documents WHERE id = $1 AND workspace_id = $2",
      [current.documentId, current.workspaceId],
    );
    if (existing.rows[0] !== undefined) {
      await dependencies.database.transaction((transaction) =>
        imports.transition(transaction, { jobId: current.id, from: "persisting", to: "succeeded" }),
      );
      await dependencies.storage.remove(current.tempObjectKey).catch(() => undefined);
      return;
    }
  }

  let state = current;
  if (current.phase === "uploading") {
    state = await dependencies.database.transaction((transaction) =>
      imports.transition(transaction, { jobId: current.id, from: "uploading", to: "parsing" }),
    );
  }

  let temporary: { directory: string; path: string } | undefined;
  const createdObjectKeys: string[] = [];
  try {
    ensureWithinDeadline();
    temporary = await downloadToTemp(dependencies.storage, current.tempObjectKey);
    const inspection = await inspectXMindFile(temporary.path);
    ensureWithinDeadline();
    const documentId = state.documentId ?? newId();
    const cloudDocument = convertXMindToCloudDocument(inspection, { documentId, version: 1 });
    const nodeCount = countDocumentNodes(cloudDocument);
    const serialized = Buffer.from(JSON.stringify(cloudDocument), "utf8");
    const snapshotSha256 = createHash("sha256").update(serialized).digest("hex");
    const originalObjectKey = `documents/${job.workspaceId}/${documentId}/original.xmind`;
    const snapshotObjectKey =
      serialized.byteLength > SNAPSHOT_OBJECT_THRESHOLD
        ? `documents/${job.workspaceId}/${documentId}/snapshots/1.json`
        : null;

    if (state.phase === "parsing") {
      state = await dependencies.database.transaction((transaction) =>
        imports.transition(transaction, { jobId: current.id, from: "parsing", to: "persisting" }),
      );
    }
    ensureWithinDeadline();
    await dependencies.storage.copy(current.tempObjectKey, originalObjectKey, "application/xmind");
    createdObjectKeys.push(originalObjectKey);
    if (snapshotObjectKey !== null) {
      await dependencies.storage.putStream({
        objectKey: snapshotObjectKey,
        stream: createMemoryReadable(serialized),
        mediaType: "application/json",
      });
      createdObjectKeys.push(snapshotObjectKey);
    }

    const imageAssets: Array<{
      sourcePath: string;
      objectKey: string;
      mediaType: string;
      byteSize: number;
      sha256: string;
    }> = [];
    for await (const asset of extractXMindAssets(temporary.path)) {
      ensureWithinDeadline();
      const objectKey = `documents/${job.workspaceId}/${documentId}/assets/${asset.sha256}`;
      await dependencies.storage.putStream({
        objectKey,
        stream: createMemoryReadable(asset.bytes),
        mediaType: asset.mediaType,
      });
      createdObjectKeys.push(objectKey);
      imageAssets.push({
        sourcePath: asset.path,
        objectKey,
        mediaType: asset.mediaType,
        byteSize: asset.bytes.byteLength,
        sha256: asset.sha256,
      });
    }
    const imageBytes = imageAssets.reduce((sum, asset) => sum + asset.byteSize, 0);
    const status = compatibilityStatus(inspection.compatibility);
    ensureWithinDeadline();
    await dependencies.database.transaction(async (transaction) => {
      const organization = await transaction.execute<{ organization_id: string }>(sql`
        SELECT organization_id FROM workspaces WHERE id = ${job.workspaceId}
      `);
      const organizationId = organization.rows[0]?.organization_id;
      if (organizationId === undefined) throw new Error("Workspace does not exist.");
      await documents.createImported(transaction, {
        documentId,
        workspaceId: job.workspaceId,
        folderId: state.targetFolderId,
        name: state.targetName,
        nameNormalized: state.targetNameNormalized,
        actorUserId: state.requestedBy,
        snapshot: cloudDocument,
        snapshotObjectKey,
        snapshotSha256,
        nodeCount,
        imageBytes,
        originalObjectKey,
        originalSha256: state.sha256 ?? "0".repeat(64),
        compatibilityStatus: status,
        compatibilityReport: inspection.compatibility,
      });
      await transaction.execute(sql`
        INSERT INTO document_assets (id, workspace_id, document_id, asset_kind, source_path, object_key, media_type, byte_size, sha256)
        VALUES (${newId()}, ${job.workspaceId}, ${documentId}, 'original', NULL, ${originalObjectKey},
                'application/xmind', ${state.actualBytes ?? 1}, ${state.sha256 ?? "0".repeat(64)})
      `);
      for (const asset of imageAssets) {
        await transaction.execute(sql`
          INSERT INTO document_assets (id, workspace_id, document_id, asset_kind, source_path, object_key, media_type, byte_size, sha256)
          VALUES (${newId()}, ${job.workspaceId}, ${documentId}, 'image', ${asset.sourcePath},
                  ${asset.objectKey}, ${asset.mediaType}, ${asset.byteSize}, ${asset.sha256})
        `);
      }
      await imports.transition(transaction, {
        jobId: current.id,
        from: "persisting",
        to: "succeeded",
        patch: {
          documentId,
          originalObjectKey,
          compatibilityStatus: status,
          compatibilityReport: inspection.compatibility,
        },
      });
      await audits.append(transaction, {
        organizationId,
        workspaceId: job.workspaceId,
        actorUserId: current.requestedBy,
        actorSessionId: null,
        action: "document.imported",
        targetType: "document",
        targetId: documentId,
        result: "success",
        requestId: `import:${current.id}`,
        fromVersion: null,
        toVersion: 1,
        metadata: { nodeCount, compatibilityStatus: status, imageCount: imageAssets.length },
      });
    });
    await dependencies.storage.remove(current.tempObjectKey).catch(() => undefined);
  } catch (error) {
    const safe = publicError(error);
    await fail(dependencies.database, imports, current.id, safe.code, safe.message);
    await Promise.all(
      createdObjectKeys.map((objectKey) =>
        dependencies.storage.remove(objectKey).catch(() => undefined),
      ),
    );
    await dependencies.storage.remove(current.tempObjectKey).catch(() => undefined);
  } finally {
    if (temporary !== undefined) await rm(temporary.directory, { recursive: true, force: true });
  }
}

async function fail(
  database: Database,
  imports: ImportRepository,
  jobId: string,
  code: string,
  message: string,
): Promise<void> {
  const current = await imports.findJob(database, jobId);
  if (
    current === null ||
    current.phase === "succeeded" ||
    current.phase === "failed" ||
    current.phase === "cancelled"
  )
    return;
  await database
    .transaction((transaction) =>
      imports.transition(transaction, {
        jobId,
        from: current.phase,
        to: "failed",
        patch: { errorCode: code, errorMessage: message },
      }),
    )
    .catch(() => undefined);
}
