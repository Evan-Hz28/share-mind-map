import {
  AuditRepository,
  DocumentRepository,
  EntityNameValidationError,
  Phase2RepositoryError,
  normalizeEntityName,
  newId,
  type Database,
  type DocumentDetail,
  type DocumentRecord,
} from "@share-mind-map/database";
import { createInitialCloudDocument, countDocumentNodes } from "@share-mind-map/document-model";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { sessionReference } from "../common/audit/session-reference.js";
import { ApiError } from "../platform/errors/api-error.js";
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

  public constructor(@Inject(AUTH_DATABASE) private readonly database: Database) {}

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
}
