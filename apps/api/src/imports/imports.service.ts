import {
  ImportRepository,
  ImportRepositoryError,
  normalizeEntityName,
  newId,
  type Database,
} from "@share-mind-map/database";
import { MinioObjectStorage, type ObjectStorage } from "@share-mind-map/storage";
import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import Busboy from "busboy";
import { Queue } from "bullmq";
import type { Request } from "express";
import Redis from "ioredis";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { APP_CONFIG } from "../platform/config/config.module.js";
import type { AppConfig } from "../platform/config/app-config.js";
import { ApiError } from "../platform/errors/api-error.js";
import type { CreateImportBatchDto } from "./dto/import-input.dto.js";
import type { ImportBatchResponseDto, ImportJobResponseDto } from "./dto/import-response.dto.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMPORT_QUEUE = "xmind-import";

interface ImportQueueJob {
  jobId: string;
  batchId: string;
  workspaceId: string;
}

function mapJob(job: Awaited<ReturnType<ImportRepository["findJob"]>>): ImportJobResponseDto {
  if (job === null) throw new ApiError("IMPORT_NOT_FOUND");
  return {
    id: job.id,
    clientFileName: job.clientFileName,
    targetName: job.targetName,
    targetFolderId: job.targetFolderId,
    documentId: job.documentId,
    phase: job.phase,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
  };
}

function constraintName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = error as { constraint?: unknown; cause?: unknown };
  if (typeof direct.constraint === "string") return direct.constraint;
  if (typeof direct.cause === "object" && direct.cause !== null) {
    const cause = direct.cause as { constraint?: unknown };
    if (typeof cause.constraint === "string") return cause.constraint;
  }
  return undefined;
}

@Injectable()
export class ImportsService implements OnApplicationShutdown {
  private readonly imports = new ImportRepository();
  private readonly queue: Queue<ImportQueueJob>;
  private readonly redis: Redis;
  private readonly storage: ObjectStorage;

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<ImportQueueJob>(IMPORT_QUEUE, {
      connection: this.redis,
      prefix: config.queuePrefix,
    });
    this.storage = new MinioObjectStorage(config.minio);
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.redis.quit();
  }

  private assertWorkspace(auth: AuthContext, workspaceId: string): void {
    if (auth.session.workspaceId !== workspaceId) throw new ApiError("PERMISSION_DENIED");
  }

  public async createBatch(
    auth: AuthContext,
    workspaceId: string,
    input: CreateImportBatchDto,
  ): Promise<ImportBatchResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    const seenNames = new Set<string>();
    const jobs = input.files.map((file) => {
      if (!file.clientFileName.toLocaleLowerCase().endsWith(".xmind")) {
        throw new ApiError("IMPORT_FILE_INVALID");
      }
      const name = normalizeEntityName(file.targetName, 100);
      if (seenNames.has(name.normalizedName)) throw new ApiError("DOCUMENT_NAME_CONFLICT");
      seenNames.add(name.normalizedName);
      return {
        id: newId(),
        clientFileName: file.clientFileName,
        targetName: name.displayName,
        targetNameNormalized: name.normalizedName,
        targetFolderId: file.targetFolderId ?? null,
        expectedBytes: file.expectedBytes ?? 0,
      };
    });
    try {
      await this.database.transaction((transaction) =>
        this.imports.createBatch(transaction, {
          batchId: newId(),
          workspaceId,
          requestedBy: auth.session.userId,
          jobs,
        }),
      );
    } catch (error) {
      if (error instanceof ImportRepositoryError) {
        if (error.code === "IMPORT_QUEUE_LIMIT_REACHED")
          throw new ApiError("IMPORT_QUEUE_LIMIT_REACHED");
        if (error.code === "IMPORT_STORAGE_QUOTA_EXCEEDED") throw new ApiError("QUOTA_EXCEEDED");
        if (error.code === "IMPORT_TARGET_CONFLICT") throw new ApiError("DOCUMENT_NAME_CONFLICT");
      }
      const constraint = (error as { constraint?: string }).constraint;
      if (constraint === "import_jobs_workspace_target_name_active_uq") {
        throw new ApiError("DOCUMENT_NAME_CONFLICT");
      }
      throw error;
    }
    const batchId = await this.findBatchIdForJob(jobs[0]?.id);
    if (batchId === null) throw new ApiError("INTERNAL_ERROR");
    return this.readBatch(auth, workspaceId, batchId);
  }

  private async findBatchIdForJob(jobId: string | undefined): Promise<string | null> {
    if (jobId === undefined) return null;
    const result = await this.database.$client.query<{ batch_id: string }>(
      "SELECT batch_id FROM import_jobs WHERE id = $1",
      [jobId],
    );
    return result.rows[0]?.batch_id ?? null;
  }

  public async readBatch(
    auth: AuthContext,
    workspaceId: string,
    batchId: string,
  ): Promise<ImportBatchResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    const batch = await this.imports.findBatch(this.database, batchId);
    if (batch === null) throw new ApiError("IMPORT_NOT_FOUND");
    if (
      batch.workspaceId !== workspaceId ||
      (batch.requestedBy !== auth.session.userId && auth.session.role !== "admin")
    ) {
      throw new ApiError("PERMISSION_DENIED");
    }
    const jobs = await this.imports.listJobsByBatch(this.database, batchId);
    return {
      id: batch.id,
      status: batch.status,
      totalJobs: batch.totalJobs,
      uploadedJobs: batch.uploadedJobs,
      succeededJobs: batch.succeededJobs,
      failedJobs: batch.failedJobs,
      cancelledJobs: batch.cancelledJobs,
      expectedBytes: batch.expectedBytes,
      jobs: jobs.map(mapJob),
    };
  }

  public async upload(
    auth: AuthContext,
    workspaceId: string,
    batchId: string,
    jobId: string,
    request: Request,
  ): Promise<ImportJobResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    const job = await this.imports.findJob(this.database, jobId);
    if (job === null || job.batchId !== batchId || job.workspaceId !== workspaceId) {
      throw new ApiError("IMPORT_NOT_FOUND");
    }
    if (job.requestedBy !== auth.session.userId && auth.session.role !== "admin") {
      throw new ApiError("PERMISSION_DENIED");
    }
    try {
      await this.database.transaction((transaction) =>
        this.imports.transition(transaction, { jobId, from: "waiting", to: "uploading" }),
      );
    } catch (error) {
      if (error instanceof ImportRepositoryError) throw new ApiError("IMPORT_STATE_CONFLICT");
      throw error;
    }
    const objectKey = `tmp/${workspaceId}/${batchId}/${jobId}/${newId()}.xmind`;
    try {
      const uploadResult = await this.receiveMultipart(request, objectKey);
      const recorded = await this.database.transaction((transaction) =>
        this.imports.recordUpload(transaction, {
          jobId,
          tempObjectKey: uploadResult.objectKey,
          compressedBytes: uploadResult.byteSize,
          actualBytes: uploadResult.byteSize,
          sha256: uploadResult.sha256,
        }),
      );
      await this.queue.add(
        "import",
        { jobId, batchId, workspaceId },
        {
          jobId: `${jobId}-attempt-${String(recorded.attemptCount)}`,
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 1000 },
        },
      );
      return mapJob(await this.imports.findJob(this.database, jobId));
    } catch (error) {
      await this.storage.remove(objectKey).catch(() => undefined);
      await this.database.transaction((transaction) =>
        this.imports
          .transition(transaction, {
            jobId,
            from: "uploading",
            to: "failed",
            patch: {
              errorCode:
                error instanceof Error && error.name === "ObjectTooLargeError"
                  ? "FILE_TOO_LARGE"
                  : "UPLOAD_FAILED",
              errorMessage:
                error instanceof Error && error.name === "ObjectTooLargeError"
                  ? "File exceeds the 20 MB limit."
                  : "Upload failed.",
            },
          })
          .catch(() => undefined),
      );
      if (error instanceof Error && error.name === "ObjectTooLargeError")
        throw new ApiError("IMPORT_FILE_TOO_LARGE");
      if (error instanceof ImportRepositoryError && error.code === "IMPORT_STORAGE_QUOTA_EXCEEDED")
        throw new ApiError("QUOTA_EXCEEDED");
      if (constraintName(error) === "import_jobs_workspace_sha256_active_uq")
        throw new ApiError("IMPORT_CONTENT_CONFLICT");
      throw new ApiError("IMPORT_FILE_INVALID");
    }
  }

  private receiveMultipart(
    request: Request,
    objectKey: string,
  ): Promise<{ objectKey: string; byteSize: number; sha256: string }> {
    return new Promise((resolve, reject) => {
      const parser = Busboy({
        headers: request.headers,
        limits: { files: 1, fileSize: MAX_FILE_BYTES },
      });
      let upload: Promise<{ objectKey: string; byteSize: number; sha256: string }> | undefined;
      let truncated = false;
      parser.on("file", (_field, stream, info) => {
        if (!info.filename.toLocaleLowerCase().endsWith(".xmind")) {
          stream.resume();
          reject(new ApiError("IMPORT_FILE_INVALID"));
          return;
        }
        stream.on("limit", () => {
          truncated = true;
        });
        upload = this.storage.putStream({
          objectKey,
          stream,
          mediaType: "application/xmind",
          maxBytes: MAX_FILE_BYTES,
        });
      });
      parser.on("error", reject);
      parser.on("finish", () => {
        void (async () => {
          if (upload === undefined) throw new ApiError("IMPORT_FILE_INVALID");
          if (truncated) throw new ApiError("IMPORT_FILE_TOO_LARGE");
          resolve(await upload);
        })().catch(reject);
      });
      request.pipe(parser);
    });
  }

  public async cancel(
    auth: AuthContext,
    workspaceId: string,
    batchId: string,
    jobId: string,
  ): Promise<ImportJobResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    const job = await this.imports.findJob(this.database, jobId);
    if (job === null || job.batchId !== batchId) throw new ApiError("IMPORT_NOT_FOUND");
    if (job.requestedBy !== auth.session.userId && auth.session.role !== "admin")
      throw new ApiError("PERMISSION_DENIED");
    try {
      const cancelled = await this.database.transaction((transaction) =>
        this.imports.transition(transaction, {
          jobId,
          from: "waiting",
          to: "cancelled",
          patch: { errorCode: "CANCELLED", errorMessage: "Cancelled by user." },
        }),
      );
      return mapJob(cancelled);
    } catch (error) {
      if (error instanceof ImportRepositoryError) throw new ApiError("IMPORT_STATE_CONFLICT");
      throw error;
    }
  }

  public async retry(
    auth: AuthContext,
    workspaceId: string,
    batchId: string,
    jobId: string,
  ): Promise<ImportJobResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    const job = await this.imports.findJob(this.database, jobId);
    if (job === null || job.batchId !== batchId) throw new ApiError("IMPORT_NOT_FOUND");
    if (job.requestedBy !== auth.session.userId && auth.session.role !== "admin")
      throw new ApiError("PERMISSION_DENIED");
    try {
      await this.database.transaction((transaction) =>
        this.imports.retryFailed(transaction, jobId),
      );
      return mapJob(await this.imports.findJob(this.database, jobId));
    } catch (error) {
      if (error instanceof ImportRepositoryError) throw new ApiError("IMPORT_STATE_CONFLICT");
      throw error;
    }
  }
}
