import {
  EntityNameValidationError,
  FolderRepository,
  Phase2RepositoryError,
  AuditRepository,
  normalizeEntityName,
  type Database,
  type FolderRecord,
} from "@share-mind-map/database";
import { MinioObjectStorage, type ObjectStorage } from "@share-mind-map/storage";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { sessionReference } from "../common/audit/session-reference.js";
import { LockService } from "../locks/lock.service.js";
import { ApiError } from "../platform/errors/api-error.js";
import type { AppConfig } from "../platform/config/app-config.js";
import { APP_CONFIG } from "../platform/config/config.module.js";
import type { FolderNameDto } from "./dto/folder-input.dto.js";
import type {
  FolderDeleteCheckResponseDto,
  FolderDto,
  FolderListResponseDto,
  FolderResponseDto,
} from "./dto/folder.dto.js";

function date(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDto(folder: FolderRecord): FolderDto {
  return {
    id: folder.id,
    workspaceId: folder.workspaceId,
    name: folder.name,
    createdAt: date(folder.createdAt),
    updatedAt: date(folder.updatedAt),
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
      case "FOLDER_NOT_FOUND":
        throw new ApiError("FOLDER_NOT_FOUND");
      case "FOLDER_LIMIT_REACHED":
        throw new ApiError("FOLDER_LIMIT_REACHED");
      case "FOLDER_DELETE_BLOCKED":
        throw new ApiError("FOLDER_DELETE_BLOCKED");
      case "FOLDER_DELETE_CONFLICT":
        throw new ApiError("FOLDER_DELETE_CONFLICT");
      default:
        throw new ApiError("INTERNAL_ERROR");
    }
  }
  const databaseError = error as {
    constraint?: unknown;
    cause?: { constraint?: unknown };
  };
  const constraint = databaseError.constraint ?? databaseError.cause?.constraint;
  if (constraint === "folders_workspace_name_active_uq") throw new ApiError("FOLDER_NAME_CONFLICT");
  throw error;
}

@Injectable()
export class FoldersService {
  private readonly folders: FolderRepository;
  private readonly audits = new AuditRepository();
  private readonly storage: ObjectStorage;
  private readonly logger = new Logger(FoldersService.name);

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly locks: LockService,
  ) {
    this.folders = new FolderRepository();
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

  public async list(auth: AuthContext, workspaceId: string): Promise<FolderListResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    const folders = await this.folders.list(this.database, workspaceId);
    return { folders: folders.map(toDto) };
  }

  public async create(
    auth: AuthContext,
    workspaceId: string,
    input: FolderNameDto,
    requestId: string,
  ): Promise<FolderResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    try {
      const name = normalizeEntityName(input.name, 50);
      const folder = await this.database.transaction(async (transaction) => {
        const organizationId = await this.organizationForWorkspace(transaction, workspaceId);
        const created = await this.folders.create(transaction, {
          workspaceId,
          name: name.displayName,
          nameNormalized: name.normalizedName,
          actorUserId: auth.session.userId,
        });
        await this.audits.append(transaction, {
          organizationId,
          workspaceId,
          actorUserId: auth.session.userId,
          actorSessionId: sessionReference(auth.sessionToken),
          action: "folder.created",
          targetType: "folder",
          targetId: created.id,
          result: "success",
          requestId,
          fromVersion: null,
          toVersion: null,
          metadata: { name: created.name },
        });
        return created;
      });
      return { folder: toDto(folder) };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  public async rename(
    auth: AuthContext,
    workspaceId: string,
    folderId: string,
    input: FolderNameDto,
    requestId: string,
  ): Promise<FolderResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    try {
      const name = normalizeEntityName(input.name, 50);
      const folder = await this.database.transaction(async (transaction) => {
        const organizationId = await this.organizationForWorkspace(transaction, workspaceId);
        const renamed = await this.folders.rename(transaction, {
          workspaceId,
          folderId,
          name: name.displayName,
          nameNormalized: name.normalizedName,
          actorUserId: auth.session.userId,
        });
        await this.audits.append(transaction, {
          organizationId,
          workspaceId,
          actorUserId: auth.session.userId,
          actorSessionId: sessionReference(auth.sessionToken),
          action: "folder.renamed",
          targetType: "folder",
          targetId: renamed.id,
          result: "success",
          requestId,
          fromVersion: null,
          toVersion: null,
          metadata: { name: renamed.name },
        });
        return renamed;
      });
      return { folder: toDto(folder) };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  public async checkDelete(
    auth: AuthContext,
    workspaceId: string,
    folderId: string,
    requestId: string,
  ): Promise<FolderDeleteCheckResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    try {
      const checked = await this.database.transaction(async (transaction) => {
        const organizationId = await this.organizationForWorkspace(transaction, workspaceId);
        const result = await this.folders.checkDelete(transaction, workspaceId, folderId);
        await this.audits.append(transaction, {
          organizationId,
          workspaceId,
          actorUserId: auth.session.userId,
          actorSessionId: sessionReference(auth.sessionToken),
          action: "folder.delete_checked",
          targetType: "folder",
          targetId: folderId,
          result: "success",
          requestId,
          fromVersion: null,
          toVersion: null,
          metadata: { documentCount: result.documentCount, canDelete: result.canDelete },
        });
        return result;
      });
      return {
        folder: toDto(checked.folder),
        documentCount: checked.documentCount,
        canDelete: checked.canDelete,
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  public async delete(
    auth: AuthContext,
    workspaceId: string,
    folderId: string,
    expectedDocumentCount: number | undefined,
    requestId: string,
  ): Promise<void> {
    this.assertWorkspace(auth, workspaceId);
    try {
      const deleted = await this.database.transaction(async (transaction) => {
        const organizationId = await this.organizationForWorkspace(transaction, workspaceId);
        const result = await this.folders.deleteWithDocuments(transaction, {
          workspaceId,
          folderId,
          ...(expectedDocumentCount === undefined ? {} : { expectedDocumentCount }),
        });
        await this.audits.append(transaction, {
          organizationId,
          workspaceId,
          actorUserId: auth.session.userId,
          actorSessionId: sessionReference(auth.sessionToken),
          action: "folder.deleted",
          targetType: "folder",
          targetId: folderId,
          result: "success",
          requestId,
          fromVersion: null,
          toVersion: null,
          metadata: {
            name: result.folder.name,
            documentCount: result.documentCount,
            deletedObjectCount: result.objectKeys.length,
          },
        });
        return result;
      });
      for (const documentId of deleted.documentIds) {
        try {
          await this.locks.discardDocumentLock(workspaceId, documentId);
        } catch (error) {
          this.logger.warn(
            `Unable to release deleted document lock ${documentId}: ${String(error)}`,
          );
        }
      }
      const removals = await Promise.allSettled(
        deleted.objectKeys.map((objectKey) => this.storage.remove(objectKey)),
      );
      for (const [index, removal] of removals.entries()) {
        if (removal.status === "rejected") {
          this.logger.warn(
            `Unable to remove deleted folder object ${deleted.objectKeys[index] ?? "unknown"}: ${String(removal.reason)}`,
          );
        }
      }
    } catch (error) {
      return mapRepositoryError(error);
    }
  }
}
