import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { countDocumentNodes, DocumentModelError } from "@share-mind-map/document-model";
import {
  convertXMindToCloudDocument,
  inspectXMindFile,
  XMindError,
  type CompatibilityIssue,
} from "@share-mind-map/xmind";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";

const FIXTURE_DOCUMENT_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const manifestSchema = z
  .object({
    generatorVersion: z.literal(1),
    fixtures: z.array(
      z
        .object({
          file: z.string().min(1),
          provenance: z.literal("synthetic"),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
          expected: z
            .object({
              status: z.enum(["accepted", "rejected"]),
              nodeCount: z.number().int().nonnegative().optional(),
              errorCode: z.string().min(1).optional(),
            })
            .strict(),
        })
        .strict(),
    ),
  })
  .strict();

export interface XMindValidationJob {
  jobId: string;
  fixtureName: string;
  expectedSha256: string;
}

export type XMindValidationStatus = "succeeded" | "rejected";

export interface XMindValidationResult {
  jobId: string;
  workerPid: number;
  status: XMindValidationStatus;
  errorCode?: string;
  nodeCount?: number;
  compatibility: CompatibilityIssue[];
}

export interface FixtureManifestEntry {
  file: string;
  sha256: string;
  expectedStatus: "accepted" | "rejected";
  expectedNodeCount?: number;
  expectedErrorCode?: string;
}

export interface XMindProcessorDependencies {
  fixtureRoot: string;
  fixtures: ReadonlyMap<string, FixtureManifestEntry>;
}

export type WorkerErrorCode =
  "FIXTURE_NOT_ALLOWED" | "FIXTURE_HASH_MISMATCH" | "FIXTURE_MANIFEST_INVALID";

export class WorkerError extends Error {
  readonly code: WorkerErrorCode;

  constructor(code: WorkerErrorCode, message: string) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream as AsyncIterable<Buffer>) hash.update(chunk);
  return hash.digest("hex");
}

export async function loadProcessorDependencies(
  fixtureRoot: string,
): Promise<XMindProcessorDependencies> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(fixtureRoot, "manifest.json"), "utf8")) as unknown;
  } catch {
    throw new WorkerError("FIXTURE_MANIFEST_INVALID", "The fixture manifest is unreadable.");
  }
  const manifest = manifestSchema.safeParse(value);
  if (!manifest.success) {
    throw new WorkerError("FIXTURE_MANIFEST_INVALID", "The fixture manifest is invalid.");
  }
  const fixtures = new Map<string, FixtureManifestEntry>();
  for (const fixture of manifest.data.fixtures) {
    if (fixtures.has(fixture.file)) {
      throw new WorkerError(
        "FIXTURE_MANIFEST_INVALID",
        "The fixture manifest has duplicate names.",
      );
    }
    fixtures.set(fixture.file, {
      file: fixture.file,
      sha256: fixture.sha256,
      expectedStatus: fixture.expected.status,
      ...(fixture.expected.nodeCount === undefined
        ? {}
        : { expectedNodeCount: fixture.expected.nodeCount }),
      ...(fixture.expected.errorCode === undefined
        ? {}
        : { expectedErrorCode: fixture.expected.errorCode }),
    });
  }
  return { fixtureRoot, fixtures };
}

export async function processJob(
  job: XMindValidationJob,
  dependencies: XMindProcessorDependencies,
): Promise<XMindValidationResult> {
  const fixture = dependencies.fixtures.get(job.fixtureName);
  if (fixture === undefined) {
    throw new WorkerError("FIXTURE_NOT_ALLOWED", "The requested fixture is not in the manifest.");
  }
  if (job.expectedSha256 !== fixture.sha256) {
    throw new WorkerError(
      "FIXTURE_HASH_MISMATCH",
      "The requested fixture hash does not match the manifest.",
    );
  }
  const path = join(dependencies.fixtureRoot, fixture.file);
  if ((await sha256File(path)) !== fixture.sha256) {
    throw new WorkerError("FIXTURE_HASH_MISMATCH", "The fixture bytes do not match the manifest.");
  }

  try {
    const inspection = await inspectXMindFile(path);
    const document = convertXMindToCloudDocument(inspection, {
      documentId: uuidv5(`fixture/${fixture.file}`, FIXTURE_DOCUMENT_NAMESPACE),
      version: 0,
    });
    return {
      jobId: job.jobId,
      workerPid: process.pid,
      status: "succeeded",
      nodeCount: countDocumentNodes(document),
      compatibility: inspection.compatibility,
    };
  } catch (error) {
    if (error instanceof XMindError || error instanceof DocumentModelError) {
      return {
        jobId: job.jobId,
        workerPid: process.pid,
        status: "rejected",
        errorCode: error.code,
        compatibility: [],
      };
    }
    throw error;
  }
}
