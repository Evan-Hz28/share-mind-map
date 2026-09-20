import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { newId, type Database } from "@share-mind-map/database";
import { MinioObjectStorage, type ObjectStorage } from "@share-mind-map/storage";
import { Inject, Injectable } from "@nestjs/common";
import Busboy from "busboy";
import { sql } from "drizzle-orm";
import type { Request } from "express";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { APP_CONFIG } from "../platform/config/config.module.js";
import type { AppConfig } from "../platform/config/app-config.js";
import { ApiError } from "../platform/errors/api-error.js";
import { LockService } from "../locks/lock.service.js";
import { inspectImage, InvalidImageError, ImageTooLargeError } from "./media-inspector.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PATH_LENGTH = 500;

export interface UploadedAssetDto {
  id: string;
  sourcePath: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  sha256: string;
}

interface AssetStream {
  stream: Readable;
  mediaType: string;
}

@Injectable()
export class AssetsService {
  private readonly storage: ObjectStorage;

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly locks: LockService,
  ) {
    this.storage = new MinioObjectStorage(config.minio);
  }

  public async upload(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    request: Request,
  ): Promise<{ asset: UploadedAssetDto }> {
    this.assertWorkspace(auth, workspaceId);
    const sourcePath = this.sourcePath(request.header("x-asset-path"));
    const lock = this.lockFromHeaders(request);
    await this.locks.heartbeat(auth, workspaceId, documentId, lock);
    let bytes: Buffer;
    try {
      bytes = await this.readMultipart(request);
    } catch (error) {
      if (error instanceof ImageTooLargeError) throw new ApiError("ASSET_TOO_LARGE");
      throw new ApiError("ASSET_INVALID");
    }
    let inspected;
    try {
      inspected = inspectImage(bytes);
    } catch (error) {
      if (error instanceof ImageTooLargeError) throw new ApiError("ASSET_TOO_LARGE");
      if (error instanceof InvalidImageError) throw new ApiError("ASSET_INVALID");
      throw error;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existing = await this.database.$client.query<{
      object_key: string;
      media_type: string;
    }>(
      `SELECT object_key, media_type FROM document_assets
       WHERE workspace_id = $1 AND sha256 = $2 AND asset_kind = 'image'
       ORDER BY created_at ASC, id ASC LIMIT 1`,
      [workspaceId, sha256],
    );
    const existingObject = existing.rows[0];
    if (existingObject !== undefined && existingObject.media_type !== inspected.mediaType) {
      throw new ApiError("ASSET_INVALID");
    }
    const assetId = newId();
    const objectKey =
      existingObject?.object_key ?? `assets/${workspaceId}/${documentId}/${assetId}`;
    let createdObject = false;
    try {
      if (existingObject === undefined) {
        await this.storage.putStream({
          objectKey,
          stream: Readable.from([bytes]),
          mediaType: inspected.mediaType,
          maxBytes: MAX_IMAGE_BYTES,
        });
        createdObject = true;
      }
      await this.locks.heartbeat(auth, workspaceId, documentId, lock);
      const row = await this.database.transaction(async (transaction) => {
        const document = await transaction.execute<{ id: string }>(sql`
          SELECT id FROM documents
          WHERE id = ${documentId} AND workspace_id = ${workspaceId} AND trashed_at IS NULL
          FOR UPDATE
        `);
        if (document.rows[0] === undefined) throw new ApiError("DOCUMENT_NOT_FOUND");
        const inserted = await transaction.execute<{
          id: string;
          source_path: string;
          media_type: "image/png" | "image/jpeg" | "image/webp";
          byte_size: number | string;
          sha256: string;
        }>(sql`
          INSERT INTO document_assets
            (id, workspace_id, document_id, asset_kind, source_path, object_key, media_type, byte_size, sha256)
          VALUES (${assetId}, ${workspaceId}, ${documentId}, 'image', ${sourcePath}, ${objectKey},
                  ${inspected.mediaType}, ${bytes.length}, ${sha256})
          RETURNING id, source_path, media_type, byte_size, sha256
        `);
        const asset = inserted.rows[0];
        if (asset === undefined) throw new Error("Asset insert returned no row.");
        return asset;
      });
      return {
        asset: {
          id: row.id,
          sourcePath: row.source_path,
          mediaType: row.media_type,
          byteSize: Number(row.byte_size),
          sha256: row.sha256,
        },
      };
    } catch (error) {
      if (createdObject) await this.storage.remove(objectKey).catch(() => undefined);
      const constraint = (error as { constraint?: unknown }).constraint;
      if (constraint === "document_assets_image_path_uq") throw new ApiError("ASSET_PATH_CONFLICT");
      if (error instanceof ApiError) throw error;
      throw new ApiError("ASSET_INVALID");
    }
  }

  public async read(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
    assetId: string,
  ): Promise<AssetStream> {
    this.assertWorkspace(auth, workspaceId);
    const referenced = await this.database.$client.query<{
      object_key: string;
      media_type: string;
    }>(
      `SELECT a.object_key, a.media_type
       FROM documents d
       JOIN snapshot_asset_refs refs ON refs.snapshot_id = d.current_snapshot_id
       JOIN document_assets a ON a.id = refs.asset_id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.trashed_at IS NULL AND a.id = $3`,
      [documentId, workspaceId, assetId],
    );
    const row = referenced.rows[0];
    if (row === undefined) {
      const asset = await this.database.$client.query<{ id: string }>(
        `SELECT id FROM document_assets WHERE id = $1 AND document_id = $2 AND workspace_id = $3`,
        [assetId, documentId, workspaceId],
      );
      throw new ApiError(asset.rows[0] === undefined ? "ASSET_NOT_FOUND" : "ASSET_NOT_REFERENCED");
    }
    return { stream: await this.storage.getStream(row.object_key), mediaType: row.media_type };
  }

  private assertWorkspace(auth: AuthContext, workspaceId: string): void {
    if (auth.session.workspaceId !== workspaceId) throw new ApiError("PERMISSION_DENIED");
  }

  private sourcePath(value: string | undefined): string {
    const path = value?.trim() ?? "";
    if (
      path.length === 0 ||
      path.length > MAX_PATH_LENGTH ||
      path.startsWith("/") ||
      path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new ApiError("ASSET_INVALID");
    }
    return path;
  }

  private lockFromHeaders(request: Request): {
    browserEditSessionId: string;
    token: string;
    generation: number;
  } {
    const browserEditSessionId = request.header("x-browser-edit-session");
    const token = request.header("x-lock-token");
    const generationText = request.header("x-lock-generation");
    const generation = generationText === undefined ? Number.NaN : Number(generationText);
    if (
      browserEditSessionId === undefined ||
      token === undefined ||
      !Number.isSafeInteger(generation) ||
      generation < 1
    ) {
      throw new ApiError("LOCK_LOST");
    }
    return { browserEditSessionId, token, generation };
  }

  private readMultipart(request: Request): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parser = Busboy({
        headers: request.headers,
        limits: { files: 1, fileSize: MAX_IMAGE_BYTES + 1 },
      });
      const chunks: Buffer[] = [];
      let seenFile = false;
      let tooLarge = false;
      parser.on("file", (_field, stream) => {
        seenFile = true;
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("limit", () => {
          tooLarge = true;
        });
      });
      parser.on("error", reject);
      parser.on("finish", () => {
        if (!seenFile) {
          reject(new InvalidImageError("Image file is missing."));
          return;
        }
        if (tooLarge || chunks.reduce((size, chunk) => size + chunk.length, 0) > MAX_IMAGE_BYTES) {
          reject(new ImageTooLargeError());
          return;
        }
        resolve(Buffer.concat(chunks));
      });
      request.pipe(parser);
    });
  }
}
