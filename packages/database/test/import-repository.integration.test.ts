import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ImportRepository, migrateDatabase } from "../src/index.js";
import {
  type DatabaseTestRuntime,
  startDatabaseTestRuntime,
  stopDatabaseTestRuntime,
} from "./support.js";

let runtime: DatabaseTestRuntime;
let workspaceId: string;
let userId: string;

beforeAll(async () => {
  runtime = await startDatabaseTestRuntime();
  await migrateDatabase(runtime.db);
  const organizationId = uuidv7();
  workspaceId = uuidv7();
  userId = uuidv7();
  await runtime.db.$client.query("INSERT INTO organizations (id, name) VALUES ($1, 'Import org')", [
    organizationId,
  ]);
  await runtime.db.$client.query(
    "INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Import workspace')",
    [workspaceId, organizationId],
  );
  await runtime.db.$client.query("INSERT INTO users (id, display_name) VALUES ($1, 'Importer')", [
    userId,
  ]);
}, 120_000);

afterAll(async () => {
  await stopDatabaseTestRuntime(runtime);
});

describe("phase 3 import repository", () => {
  it("creates a batch and its jobs atomically, then aggregates terminal states", async () => {
    const repository = new ImportRepository();
    const batchId = uuidv7();
    const firstJobId = uuidv7();
    const secondJobId = uuidv7();

    await runtime.db.transaction((transaction) =>
      repository.createBatch(transaction, {
        batchId,
        workspaceId,
        requestedBy: userId,
        jobs: [
          {
            id: firstJobId,
            clientFileName: "one.xmind",
            targetName: "One",
            targetNameNormalized: "one",
            expectedBytes: 10,
          },
          {
            id: secondJobId,
            clientFileName: "two.xmind",
            targetName: "Two",
            targetNameNormalized: "two",
            expectedBytes: 20,
          },
        ],
      }),
    );

    expect(await repository.findBatch(runtime.db, batchId)).toMatchObject({
      id: batchId,
      status: "pending",
      totalJobs: 2,
      expectedBytes: 30,
    });
    expect(await repository.findJob(runtime.db, firstJobId)).toMatchObject({
      id: firstJobId,
      phase: "waiting",
      batchId,
    });

    await runtime.db.transaction((transaction) =>
      repository.transition(transaction, {
        jobId: firstJobId,
        from: "waiting",
        to: "uploading",
        patch: { tempObjectKey: "tmp/import/one" },
      }),
    );
    await runtime.db.transaction((transaction) =>
      repository.transition(transaction, {
        jobId: firstJobId,
        from: "uploading",
        to: "failed",
        patch: { errorCode: "PARSE_FAILED", errorMessage: "bad map" },
      }),
    );
    await runtime.db.transaction((transaction) =>
      repository.transition(transaction, {
        jobId: secondJobId,
        from: "waiting",
        to: "cancelled",
        patch: { errorCode: "CANCELLED", errorMessage: "cancelled by user" },
      }),
    );

    expect(await repository.findBatch(runtime.db, batchId)).toMatchObject({
      status: "failed",
      uploadedJobs: 1,
      failedJobs: 1,
      cancelledJobs: 1,
    });
  });

  it("allows cancellation only from waiting and retries a failed job", async () => {
    const repository = new ImportRepository();
    const batchId = uuidv7();
    const jobId = uuidv7();
    await runtime.db.transaction((transaction) =>
      repository.createBatch(transaction, {
        batchId,
        workspaceId,
        requestedBy: userId,
        jobs: [
          {
            id: jobId,
            clientFileName: "retry.xmind",
            targetName: `Retry ${jobId.slice(-6)}`,
            targetNameNormalized: `retry-${jobId.slice(-6)}`,
            expectedBytes: 1,
          },
        ],
      }),
    );
    await expect(
      runtime.db.transaction((transaction) =>
        repository.transition(transaction, {
          jobId,
          from: "waiting",
          to: "parsing",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT_TRANSITION" });
    await runtime.db.transaction((transaction) =>
      repository.transition(transaction, { jobId, from: "waiting", to: "uploading" }),
    );
    await runtime.db.transaction((transaction) =>
      repository.transition(transaction, { jobId, from: "uploading", to: "failed" }),
    );
    await runtime.db.transaction((transaction) => repository.retryFailed(transaction, jobId));
    expect(await repository.findJob(runtime.db, jobId)).toMatchObject({
      phase: "waiting",
      attemptCount: 1,
      errorCode: null,
    });
  });
});
