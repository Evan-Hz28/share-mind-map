import { createHash } from "node:crypto";

import { AuditRepository, type Database } from "@share-mind-map/database";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE, AUTH_REDIS } from "../auth/auth.tokens.js";
import { sessionReference } from "../common/audit/session-reference.js";
import { APP_CONFIG } from "../platform/config/config.module.js";
import type { AppConfig } from "../platform/config/app-config.js";
import { ApiError } from "../platform/errors/api-error.js";
import { DocumentRoomService } from "../realtime/document-room.service.js";
import type { AcquireLockDto, ForceReleaseLockDto, LockLeaseDto } from "./dto/lock.dto.js";
import { LockStore, type LockRedisClient } from "./lock.store.js";

interface PublicLock {
  occupied: boolean;
  generation: number;
  heartbeatAt?: string;
  ttlSeconds: number;
  expiresAt: string;
  editorDisplayName?: string;
}

@Injectable()
export class LockService {
  private readonly locks: LockStore;
  private readonly audits = new AuditRepository();

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    @Inject(AUTH_REDIS) redis: LockRedisClient,
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() private readonly documentRooms?: DocumentRoomService,
  ) {
    this.locks = new LockStore(redis, {
      keyPrefix: config.queuePrefix,
      ttlSeconds: config.documentLockTtlSeconds,
      secret: config.sessionSecret,
    });
  }

  public async acquire(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    input: AcquireLockDto,
  ): Promise<{ lock: PublicLock & { token: string } }> {
    await this.assertDocument(auth, workspaceId, documentId);
    const result = await this.locks.acquire({
      documentId,
      userId: auth.session.userId,
      platformSessionId: this.platformSessionId(auth),
      browserEditSessionId: input.browserEditSessionId,
    });
    if (result.status === "occupied") throw new ApiError("DOCUMENT_LOCKED");
    const lock = await this.publicLockAndBroadcast(workspaceId, documentId);
    return { lock: { ...lock, token: result.token } };
  }

  public async heartbeat(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    input: LockLeaseDto,
  ): Promise<{ generation: number; ttlSeconds: number; expiresAt: string }> {
    await this.assertDocument(auth, workspaceId, documentId);
    const result = await this.locks.heartbeat(
      {
        documentId,
        userId: auth.session.userId,
        platformSessionId: this.platformSessionId(auth),
        browserEditSessionId: input.browserEditSessionId,
      },
      input.token,
      input.generation,
    );
    if (result.status === "lost") throw new ApiError("LOCK_LOST");
    return {
      generation: result.generation,
      ttlSeconds: result.ttlSeconds,
      expiresAt: this.expiresAt(result.ttlSeconds),
    };
  }

  public async recover(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    input: AcquireLockDto,
  ): Promise<{ lock: PublicLock & { token: string } }> {
    await this.assertDocument(auth, workspaceId, documentId);
    const result = await this.locks.recover({
      documentId,
      userId: auth.session.userId,
      platformSessionId: this.platformSessionId(auth),
      browserEditSessionId: input.browserEditSessionId,
    });
    if (result.status === "lost") throw new ApiError("LOCK_LOST");
    const lock = await this.publicLockAndBroadcast(workspaceId, documentId);
    return { lock: { ...lock, token: result.token } };
  }

  public async release(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    input: LockLeaseDto,
  ): Promise<{ lock: PublicLock }> {
    await this.assertDocument(auth, workspaceId, documentId);
    const released = await this.locks.release(
      {
        documentId,
        userId: auth.session.userId,
        platformSessionId: this.platformSessionId(auth),
        browserEditSessionId: input.browserEditSessionId,
      },
      input.token,
      input.generation,
    );
    if (!released) throw new ApiError("LOCK_LOST");
    return { lock: await this.publicLockAndBroadcast(workspaceId, documentId) };
  }

  public async inspect(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
  ): Promise<{ lock: PublicLock }> {
    await this.assertDocument(auth, workspaceId, documentId);
    return { lock: await this.publicLock(documentId) };
  }

  public async forceRelease(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    input: ForceReleaseLockDto,
    requestId: string,
  ): Promise<{ lock: PublicLock }> {
    if (!input.confirm) throw new ApiError("INVALID_INPUT");
    await this.assertDocument(auth, workspaceId, documentId);
    await this.database.transaction(async (transaction) => {
      const organization = await transaction.execute<{ organization_id: string }>(sql`
        SELECT organization_id FROM workspaces WHERE id = ${workspaceId}
      `);
      const organizationId = organization.rows[0]?.organization_id;
      if (organizationId === undefined) throw new ApiError("NOT_FOUND");
      const result = await this.locks.forceRelease(documentId);
      await this.audits.append(transaction, {
        organizationId,
        workspaceId,
        actorUserId: auth.session.userId,
        actorSessionId: sessionReference(auth.sessionToken),
        action: "document.lock.force_released",
        targetType: "document",
        targetId: documentId,
        result: "success",
        requestId,
        fromVersion: null,
        toVersion: null,
        metadata: { generation: result.generation },
      });
    });
    return { lock: await this.publicLockAndBroadcast(workspaceId, documentId) };
  }

  private async assertDocument(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
  ): Promise<void> {
    if (auth.session.workspaceId !== workspaceId) throw new ApiError("PERMISSION_DENIED");
    const result = await this.database.$client.query<{ id: string }>(
      `SELECT id FROM documents WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
      [documentId, workspaceId],
    );
    if (result.rows[0] === undefined) throw new ApiError("DOCUMENT_NOT_FOUND");
  }

  private async publicLock(documentId: string): Promise<PublicLock> {
    const inspection = await this.locks.inspect(documentId);
    if (!inspection.occupied) {
      return {
        occupied: false,
        generation: inspection.generation,
        ttlSeconds: inspection.ttlSeconds,
        expiresAt: this.expiresAt(inspection.ttlSeconds),
      };
    }
    const user = await this.database.$client.query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE id = $1`,
      [inspection.userId],
    );
    const displayName = user.rows[0]?.display_name;
    return {
      occupied: true,
      generation: inspection.generation,
      ttlSeconds: inspection.ttlSeconds,
      expiresAt: this.expiresAt(inspection.ttlSeconds),
      ...(inspection.heartbeatAt === undefined ? {} : { heartbeatAt: inspection.heartbeatAt }),
      ...(displayName === undefined ? {} : { editorDisplayName: displayName }),
    };
  }

  private async publicLockAndBroadcast(
    workspaceId: string,
    documentId: string,
  ): Promise<PublicLock> {
    const lock = await this.publicLock(documentId);
    this.documentRooms?.broadcastLock({
      workspaceId,
      documentId,
      occupied: lock.occupied,
      editorDisplayName: lock.editorDisplayName ?? null,
      expiresAt: lock.expiresAt,
      generation: lock.generation,
    });
    return lock;
  }

  private platformSessionId(auth: AuthContext): string {
    return createHash("sha256").update(auth.sessionToken, "utf8").digest("hex");
  }

  private expiresAt(ttlSeconds: number): string {
    return new Date(Date.now() + Math.max(ttlSeconds, 0) * 1000).toISOString();
  }
}
