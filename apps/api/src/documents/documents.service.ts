import { createHash } from "node:crypto";

import {
  AuditRepository,
  DocumentRepository,
  EntityNameValidationError,
  Phase2RepositoryError,
  Phase4RepositoryError,
  normalizeEntityName,
  newId,
  type Database,
  type DocumentDetail,
  type DocumentRecord,
} from "@share-mind-map/database";
import { MinioObjectStorage, type ObjectStorage } from "@share-mind-map/storage";
import {
  DocumentModelError,
  countDocumentNodes,
  createInitialCloudDocument,
  normalizeCloudDocumentVersion,
  parseCloudDocument,
} from "@share-mind-map/document-model";
import { exportCloudDocumentToXMind } from "@share-mind-map/xmind";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { sessionReference } from "../common/audit/session-reference.js";
import { ApiError } from "../platform/errors/api-error.js";
import type { AppConfig } from "../platform/config/app-config.js";
import { APP_CONFIG } from "../platform/config/config.module.js";
import type { DraftExportDto, SaveSnapshotDto } from "./dto/document-save.dto.js";
import type { SnapshotResponseDto } from "./dto/document.dto.js";
import { LockService } from "../locks/lock.service.js";
import { DocumentRoomService } from "../realtime/document-room.service.js";
import type {
  CreateDocumentDto,
  DocumentListQueryDto,
  UpdateDocumentDto,
} from "./dto/document-input.dto.js";
import type {
  DocumentDetailDto,
  DocumentDetailResponseDto,
  DocumentDto,
  DocumentListResponseDto,
  DocumentResponseDto,
} from "./dto/document.dto.js";

function toDto(document: DocumentRecord): DocumentDto {
  return {
    id: document.id,
    workspaceId: document.workspaceId,
    folderId: document.folderId,
    name: document.name,
    currentVersion: document.currentVersion,
    schemaVersion: document.schemaVersion,
    compatibilityStatus: document.compatibilityStatus,
    nodeCount: document.nodeCount,
    imageBytes: document.imageBytes,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toDetailDto(document: DocumentDetail): DocumentDetailDto {
  const metadata = toDto(document);
  return {
    id: metadata.id,
    workspaceId: metadata.workspaceId,
    folderId: metadata.folderId,
    name: metadata.name,
    currentVersion: metadata.currentVersion,
    schemaVersion: metadata.schemaVersion,
    compatibilityStatus: metadata.compatibilityStatus,
    nodeCount: metadata.nodeCount,
    imageBytes: metadata.imageBytes,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    snapshot: document.snapshot as Record<string, unknown>,
  };
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof EntityNameValidationError) {
    throw new ApiError(error.reason === "required" ? "NAME_REQUIRED" : "NAME_TOO_LONG");
  }
  if (error instanceof Phase2RepositoryError) {
    switch (error.code) {
      case "WORKSPACE_NOT_FOUND":
        throw new ApiError("NOT_FOUND");
      case "DOCUMENT_NOT_FOUND":
        throw new ApiError("DOCUMENT_NOT_FOUND");
      case "FOLDER_NOT_IN_WORKSPACE":
        throw new ApiError("DOCUMENT_FOLDER_INVALID");
      case "FOLDER_DOCUMENT_LIMIT_REACHED":
        throw new ApiError("FOLDER_DOCUMENT_LIMIT_REACHED");
      case "WORKSPACE_DOCUMENT_LIMIT_REACHED":
        throw new ApiError("WORKSPACE_DOCUMENT_LIMIT_REACHED");
      default:
        throw new ApiError("INTERNAL_ERROR");
    }
  }
  if (error instanceof Phase4RepositoryError) {
    throw new ApiError(error.code);
  }
  if (error instanceof DocumentModelError) {
    if (error.code === "DOCUMENT_NODE_LIMIT_REACHED")
      throw new ApiError("DOCUMENT_NODE_LIMIT_REACHED");
    throw new ApiError("DOCUMENT_SCHEMA_INVALID");
  }
  const databaseError = error as {
    constraint?: unknown;
    cause?: { constraint?: unknown };
  };
  const constraint = databaseError.constraint ?? databaseError.cause?.constraint;
  if (constraint === "documents_workspace_name_active_uq")
    throw new ApiError("DOCUMENT_NAME_CONFLICT");
  throw error;
}

@Injectable()
export class DocumentsService {
  private readonly documents = new DocumentRepository();
  private readonly audits = new AuditRepository();
  private readonly storage: ObjectStorage;
  private readonly logger = new Logger(DocumentsService.name);

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly locks: LockService,
    @Optional() private readonly documentRooms?: DocumentRoomService,
  ) {
    this.storage = new MinioObjectStorage(config.minio);
  }

  private assertWorkspace(auth: AuthContext, workspaceId: string): void {
    if (auth.session.workspaceId !== workspaceId) throw new ApiError("PERMISSION_DENIED");
  }

  private async organizationForWorkspace(
    transaction: import("@share-mind-map/database").DatabaseTransaction,
    workspaceId: string,
  ): Promise<string> {
    const result = await transaction.execute<{ organization_id: string }>(sql`
      SELECT organization_id FROM workspaces WHERE id = ${workspaceId}
    `);
    const organizationId = result.rows[0]?.organization_id;
    if (organizationId === undefined) throw new ApiError("NOT_FOUND");
    return organizationId;
  }

  public async saveSnapshot(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    input: SaveSnapshotDto,
    idempotencyKey: string,
    requestId: string,
  ): Promise<SnapshotResponseDto & { idempotent: boolean }> {
    this.assertWorkspace(auth, workspaceId);
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) throw new ApiError("INVALID_INPUT");
    try {
      const parsed = parseCloudDocument(input.snapshot);
      if (parsed.documentId !== documentId) throw new ApiError("DOCUMENT_SCHEMA_INVALID");
      const snapshot = normalizeCloudDocumentVersion(parsed, input.baseVersion + 1);
      const referencedAssets = new Set<string>();
      for (const sheet of snapshot.sheets) {
        for (const node of Object.values(sheet.nodes)) {
          if (node.imageAssetId !== null) referencedAssets.add(node.imageAssetId);
        }
      }
      const assetIds = [...new Set(input.assetIds)];
      if (assetIds.some((assetId) => !referencedAssets.has(assetId))) {
        throw new ApiError("DOCUMENT_ASSET_INVALID");
      }
      for (const assetId of referencedAssets) {
        if (!assetIds.includes(assetId)) throw new ApiError("DOCUMENT_ASSET_INVALID");
      }
      await this.locks.heartbeat(auth, workspaceId, documentId, {
        browserEditSessionId: input.browserEditSessionId,
        token: input.token,
        generation: input.generation,
      });
      const serialized = JSON.stringify(snapshot);
      const result = await this.database.transaction(async (transaction) => {
        const saved = await this.documents.saveSnapshot(transaction, {
          workspaceId,
          documentId,
          actorUserId: auth.session.userId,
          baseVersion: input.baseVersion,
          saveKind: input.saveKind,
          snapshot,
          snapshotSha256: createHash("sha256").update(serialized).digest("hex"),
          snapshotJson: snapshot,
          snapshotObjectKey: null,
          imageBytes: input.imageBytes,
          assetIds,
          idempotencyKey,
        });
        const organizationId = await this.organizationForWorkspace(transaction, workspaceId);
        await this.audits.append(transaction, {
          organizationId,
          workspaceId,
          actorUserId: auth.session.userId,
          actorSessionId: sessionReference(auth.sessionToken),
          action: "document.snapshot.saved",
          targetType: "document",
          targetId: documentId,
          result: "success",
          requestId,
          fromVersion: input.baseVersion,
          toVersion: saved.snapshot.version,
          metadata: {
            saveKind: input.saveKind,
            version: saved.snapshot.version,
            nodeCount: countDocumentNodes(snapshot),
            snapshotSha256: saved.snapshot.snapshotSha256,
          },
        });
        return saved;
      });
      try {
        this.documentRooms?.broadcastSnapshot({
          workspaceId,
          documentId,
          snapshot,
          version: result.snapshot.version,
          browserEditSessionId: input.browserEditSessionId,
        });
      } catch {
        // The database commit remains authoritative; clients recover through REST.
      }
      return {
        idempotent: result.idempotent,
        document: toDto(result.document),
        snapshot: {
          id: result.snapshot.id,
          version: result.snapshot.version,
          schemaVersion: result.snapshot.schemaVersion,
          sha256: result.snapshot.snapshotSha256,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return mapRepositoryError(error);
    }
  }

  public async draftExport(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    input: DraftExportDto,
  ): Promise<{ fileName: string; bytes: Buffer; compatibilityStatus: "full" | "partial" }> {
    this.assertWorkspace(auth, workspaceId);
    try {
      const document = await this.database.$client.query<{ name: string }>(
        `SELECT name FROM documents WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
        [documentId, workspaceId],
      );
      const name = document.rows[0]?.name;
      if (name === undefined) throw new ApiError("DOCUMENT_NOT_FOUND");
      const parsed = parseCloudDocument(input.snapshot);
      if (parsed.documentId !== documentId) throw new ApiError("DOCUMENT_SCHEMA_INVALID");
      const result = await exportCloudDocumentToXMind(parsed, { assets: [] });
      return {
        fileName: `${Array.from(name, (character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 32 || '\\/:*?"<>|'.includes(character) ? "_" : character;
        }).join("")}.xmind`,
        bytes: result.bytes,
        compatibilityStatus: result.compatibility.status,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return mapRepositoryError(error);
    }
  }

  public async list(
    auth: AuthContext,
    workspaceId: string,
    query: DocumentListQueryDto,
  ): Promise<DocumentListResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    const result = await this.documents.list(this.database, {
      workspaceId,
      sort: query.sort,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return { documents: result.documents.map(toDto), nextCursor: result.nextCursor };
  }

  public async detail(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentDetailResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    const document = await this.documents.findDetail(this.database, workspaceId, documentId);
    if (document === null) throw new ApiError("DOCUMENT_NOT_FOUND");
    return { document: toDetailDto(document) };
  }

  public async create(
    auth: AuthContext,
    workspaceId: string,
    input: CreateDocumentDto,
    requestId: string,
  ): Promise<DocumentResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    try {
      const name = normalizeEntityName(input.name, 100);
      const document = await this.database.transaction(async (transaction) => {
        const organizationId = await this.organizationForWorkspace(transaction, workspaceId);
        const documentId = newId();
        const snapshot = createInitialCloudDocument(documentId);
        const created = await this.documents.createBlank(transaction, {
          documentId,
          workspaceId,
          folderId: input.folderId ?? null,
          name: name.displayName,
          nameNormalized: name.normalizedName,
          actorUserId: auth.session.userId,
          snapshot,
          nodeCount: countDocumentNodes(snapshot),
        });
        await this.audits.append(transaction, {
          organizationId,
          workspaceId,
          actorUserId: auth.session.userId,
          actorSessionId: sessionReference(auth.sessionToken),
          action: "document.created",
          targetType: "document",
          targetId: created.id,
          result: "success",
          requestId,
          fromVersion: null,
          toVersion: 1,
          metadata: { name: created.name, nodeCount: created.nodeCount },
        });
        return created;
      });
      return { document: toDto(document) };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  public async update(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    input: UpdateDocumentDto,
    requestId: string,
  ): Promise<DocumentResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    const hasName = input.name !== undefined;
    const hasFolder = Object.prototype.hasOwnProperty.call(input, "folderId");
    if (!hasName && !hasFolder) throw new ApiError("INVALID_INPUT");
    try {
      const normalized = hasName ? normalizeEntityName(input.name as string, 100) : null;
      const document = await this.database.transaction(async (transaction) => {
        const organizationId = await this.organizationForWorkspace(transaction, workspaceId);
        let updated: DocumentRecord | undefined;
        if (normalized !== null) {
          updated = await this.documents.rename(transaction, {
            workspaceId,
            documentId,
            name: normalized.displayName,
            nameNormalized: normalized.normalizedName,
            actorUserId: auth.session.userId,
          });
          await this.audits.append(transaction, {
            organizationId,
            workspaceId,
            actorUserId: auth.session.userId,
            actorSessionId: sessionReference(auth.sessionToken),
            action: "document.renamed",
            targetType: "document",
            targetId: documentId,
            result: "success",
            requestId,
            fromVersion: updated.currentVersion,
            toVersion: updated.currentVersion,
            metadata: { name: updated.name },
          });
        }
        if (hasFolder) {
          updated = await this.documents.move(transaction, {
            workspaceId,
            documentId,
            folderId: input.folderId ?? null,
            actorUserId: auth.session.userId,
          });
          await this.audits.append(transaction, {
            organizationId,
            workspaceId,
            actorUserId: auth.session.userId,
            actorSessionId: sessionReference(auth.sessionToken),
            action: "document.moved",
            targetType: "document",
            targetId: documentId,
            result: "success",
            requestId,
            fromVersion: updated.currentVersion,
            toVersion: updated.currentVersion,
            metadata: { folderId: updated.folderId },
          });
        }
        if (updated === undefined) throw new ApiError("INVALID_INPUT");
        return updated;
      });
      return { document: toDto(document) };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  public async remove(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    requestId: string,
  ): Promise<void> {
    this.assertWorkspace(auth, workspaceId);
    try {
      const deleted = await this.database.transaction(async (transaction) => {
        const result = await this.documents.permanentlyDelete(transaction, {
          workspaceId,
          documentId,
        });
        const organizationId = await this.organizationForWorkspace(transaction, workspaceId);
        await this.audits.append(transaction, {
          organizationId,
          workspaceId,
          actorUserId: auth.session.userId,
          actorSessionId: sessionReference(auth.sessionToken),
          action: "document.deleted",
          targetType: "document",
          targetId: documentId,
          result: "success",
          requestId,
          fromVersion: null,
          toVersion: null,
          metadata: { deletedObjectCount: result.objectKeys.length },
        });
        return result;
      });
      try {
        await this.locks.discardDocumentLock(workspaceId, documentId);
      } catch (error) {
        this.logger.warn(`Unable to release deleted document lock ${documentId}: ${String(error)}`);
      }
      const removals = await Promise.allSettled(
        deleted.objectKeys.map((objectKey) => this.storage.remove(objectKey)),
      );
      for (const [index, removal] of removals.entries()) {
        if (removal.status === "rejected") {
          this.logger.warn(
            `Unable to remove deleted document object ${deleted.objectKeys[index] ?? "unknown"}: ${String(removal.reason)}`,
          );
        }
      }
    } catch (error) {
      return mapRepositoryError(error);
    }
  }
}
