import { newId, type Database } from "@share-mind-map/database";
import { parseCloudDocument } from "@share-mind-map/document-model";
import { exportCloudDocumentToXMind, type ExportAssetInput } from "@share-mind-map/xmind";
import { MinioObjectStorage, type ObjectStorage } from "@share-mind-map/storage";
import { Inject, Injectable } from "@nestjs/common";
import type { Readable } from "node:stream";
import { v5 as uuidv5 } from "uuid";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { APP_CONFIG } from "../platform/config/config.module.js";
import type { AppConfig } from "../platform/config/app-config.js";
import { ApiError } from "../platform/errors/api-error.js";

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export interface ExportResult {
  fileName: string;
  bytes: Buffer;
  compatibilityStatus: "full" | "partial";
}

@Injectable()
export class ExportsService {
  private readonly storage: ObjectStorage;

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.storage = new MinioObjectStorage(config.minio);
  }

  public async export(
    auth: AuthContext,
    workspaceId: string,
    documentId: string,
  ): Promise<ExportResult> {
    if (auth.session.workspaceId !== workspaceId) throw new ApiError("PERMISSION_DENIED");
    const document = await this.database.$client.query<{
      name: string;
      current_version: number;
      snapshot_json: unknown;
      snapshot_object_key: string | null;
    }>(
      `SELECT d.name, d.current_version, s.snapshot_json, s.snapshot_object_key
       FROM documents d JOIN document_snapshots s ON s.id = d.current_snapshot_id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.trashed_at IS NULL`,
      [documentId, workspaceId],
    );
    const row = document.rows[0];
    if (row === undefined) throw new ApiError("DOCUMENT_NOT_FOUND");
    const exportId = newId();
    await this.database.$client.query(
      `INSERT INTO export_jobs (id, workspace_id, document_id, requested_by, document_version, status)
       VALUES ($1, $2, $3, $4, $5, 'exporting')`,
      [exportId, workspaceId, documentId, auth.session.userId, row.current_version],
    );
    try {
      const snapshotBytes =
        row.snapshot_object_key === null
          ? Buffer.from(JSON.stringify(row.snapshot_json), "utf8")
          : await readAll(await this.storage.getStream(row.snapshot_object_key));
      const documentModel = parseCloudDocument(JSON.parse(snapshotBytes.toString("utf8")));
      const assetsRows = await this.database.$client.query<{
        object_key: string;
        source_path: string | null;
        media_type: "image/png" | "image/jpeg" | "image/webp";
      }>(
        `SELECT object_key, source_path, media_type FROM document_assets
         WHERE document_id = $1 AND asset_kind = 'image' ORDER BY source_path ASC`,
        [documentId],
      );
      const assets: ExportAssetInput[] = [];
      for (const asset of assetsRows.rows) {
        if (asset.source_path === null) continue;
        assets.push({
          assetId: uuidv5(`asset/${asset.source_path}`, documentId),
          path: asset.source_path,
          mediaType: asset.media_type,
          bytes: await readAll(await this.storage.getStream(asset.object_key)),
        });
      }
      const result = await exportCloudDocumentToXMind(documentModel, { assets });
      await this.database.$client.query(
        `UPDATE export_jobs SET status = 'succeeded', compatibility_status = $2,
                compatibility_report = $3::jsonb, expires_at = now() + interval '5 minutes',
                completed_at = now(), updated_at = now() WHERE id = $1`,
        [exportId, result.compatibility.status, JSON.stringify(result.compatibility.issues)],
      );
      return {
        fileName: `${Array.from(row.name, (character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 32 || '\\/:*?"<>|'.includes(character) ? "_" : character;
        }).join("")}.xmind`,
        bytes: result.bytes,
        compatibilityStatus: result.compatibility.status,
      };
    } catch (error) {
      await this.database.$client.query(
        `UPDATE export_jobs SET status = 'failed', error_code = 'EXPORT_FAILED',
                error_message = 'Export failed.', updated_at = now() WHERE id = $1`,
        [exportId],
      );
      if (error instanceof ApiError) throw error;
      throw new ApiError("INTERNAL_ERROR");
    }
  }
}
