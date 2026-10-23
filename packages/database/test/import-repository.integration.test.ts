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

  it("lists a batch's jobs in one query, in creation order", async () => {
    const repository = new ImportRepository();
    const batchId = uuidv7();
    const jobIds = [uuidv7(), uuidv7(), uuidv7()];
    await runtime.db.transaction((transaction) =>
      repository.createBatch(transaction, {
        batchId,
        workspaceId,
        requestedBy: userId,
        jobs: jobIds.map((id, index) => ({
          id,
          clientFileName: `list-${String(index)}.xmind`,
          targetName: `List ${String(index)} ${id.slice(-6)}`,
          targetNameNormalized: `list-${String(index)}-${id.slice(-6)}`,
          expectedBytes: 1,
        })),
      }),
    );

    const jobs = await repository.listJobsByBatch(runtime.db, batchId);
    expect(jobs.map((job) => job.id)).toEqual(jobIds);
    expect(await repository.listJobsByBatch(runtime.db, uuidv7())).toEqual([]);
  });
});

describe("phase 3 import caps", () => {
  const repository = new ImportRepository();

  /** 每个用例自己一套 org/workspace/user,免得上面那个库里的等待任务把边界算歪。 */
  async function createScope(): Promise<{ workspaceId: string; userId: string }> {
    const organizationId = uuidv7();
    const workspaceId = uuidv7();
    const userId = uuidv7();
    await runtime.db.$client.query("INSERT INTO organizations (id, name) VALUES ($1, 'Caps org')", [
      organizationId,
    ]);
    await runtime.db.$client.query(
      "INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Caps workspace')",
      [workspaceId, organizationId],
    );
    await runtime.db.$client.query("INSERT INTO users (id, display_name) VALUES ($1, 'Capper')", [
      userId,
    ]);
    return { workspaceId, userId };
  }

  function batchOf(
    workspace: string,
    user: string,
    count: number,
    prefix: string,
  ): { batchId: string; jobs: Array<Record<string, unknown>> } {
    const batchId = uuidv7();
    return {
      batchId,
      jobs: Array.from({ length: count }, (_, index) => {
        const id = uuidv7();
        return {
          id,
          clientFileName: `${prefix}-${String(index)}.xmind`,
          targetName: `${prefix} ${String(index)} ${id.slice(-8)}`,
          targetNameNormalized: `${prefix}-${String(index)}-${id.slice(-8)}`,
          expectedBytes: 1,
        };
      }),
    };
  }

  function create(workspace: string, user: string, count: number, prefix: string): Promise<void> {
    const { batchId, jobs } = batchOf(workspace, user, count, prefix);
    return runtime.db.transaction((transaction) =>
      repository.createBatch(transaction, {
        batchId,
        workspaceId: workspace,
        requestedBy: user,
        // 结构上就是 createBatch 要的形状,断言的是上限而不是类型。
        jobs: jobs as Parameters<typeof repository.createBatch>[1]["jobs"],
      }),
    );
  }

  it("accepts a hundred files in one batch and rejects a hundred and one", async () => {
    const scope = await createScope();
    await expect(create(scope.workspaceId, scope.userId, 100, "hundred")).resolves.toBeUndefined();
    await expect(
      create(scope.workspaceId, scope.userId, 101, "hundred-over"),
    ).rejects.toMatchObject({
      code: "IMPORT_QUEUE_LIMIT_REACHED",
    });
  });

  it("stops at a hundred and fifty waiting jobs for one user", async () => {
    const scope = await createScope();
    await create(scope.workspaceId, scope.userId, 100, "user-cap-a");
    // 100 + 50 = 150,正好卡在上限上,还能过。
    await expect(create(scope.workspaceId, scope.userId, 50, "user-cap-b")).resolves.toBeUndefined();
    await expect(create(scope.workspaceId, scope.userId, 1, "user-cap-c")).rejects.toMatchObject({
      code: "IMPORT_QUEUE_LIMIT_REACHED",
    });
  });

  it("frees a target name after the import job succeeds", async () => {
    const scope = await createScope();
    const target = `released-${uuidv7().slice(-8)}`;
    const firstJobId = uuidv7();
    await runtime.db.transaction((transaction) =>
      repository.createBatch(transaction, {
        batchId: uuidv7(),
        workspaceId: scope.workspaceId,
        requestedBy: scope.userId,
        jobs: [
          {
            id: firstJobId,
            clientFileName: "first.xmind",
            targetName: target,
            targetNameNormalized: target,
            expectedBytes: 1,
          },
        ],
      }),
    );
    await runtime.db.$client.query("UPDATE import_jobs SET phase = 'succeeded' WHERE id = $1", [
      firstJobId,
    ]);

    await expect(
      runtime.db.transaction((transaction) =>
        repository.createBatch(transaction, {
          batchId: uuidv7(),
          workspaceId: scope.workspaceId,
          requestedBy: scope.userId,
          jobs: [
            {
              id: uuidv7(),
              clientFileName: "again.xmind",
              targetName: target,
              targetNameNormalized: target,
              expectedBytes: 1,
            },
          ],
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("still blocks a target name while another import job is active", async () => {
    const scope = await createScope();
    const target = `active-${uuidv7().slice(-8)}`;
    await runtime.db.transaction((transaction) =>
      repository.createBatch(transaction, {
        batchId: uuidv7(),
        workspaceId: scope.workspaceId,
        requestedBy: scope.userId,
        jobs: [
          {
            id: uuidv7(),
            clientFileName: "first.xmind",
            targetName: target,
            targetNameNormalized: target,
            expectedBytes: 1,
          },
        ],
      }),
    );

    await expect(
      runtime.db.transaction((transaction) =>
        repository.createBatch(transaction, {
          batchId: uuidv7(),
          workspaceId: scope.workspaceId,
          requestedBy: scope.userId,
          jobs: [
            {
              id: uuidv7(),
              clientFileName: "second.xmind",
              targetName: target,
              targetNameNormalized: target,
              expectedBytes: 1,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "IMPORT_NAME_CONFLICT",
      conflictNames: [target],
    });
  });

  it("stops at three hundred waiting jobs in one workspace, even across users", async () => {
    const scope = await createScope();
    const otherUsers: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const userId = uuidv7();
      otherUsers.push(userId);
      await runtime.db.$client.query("INSERT INTO users (id, display_name) VALUES ($1, 'Capper')", [
        userId,
      ]);
    }
    const everyone = [scope.userId, ...otherUsers];
    for (const [index, userId] of everyone.entries()) {
      await create(scope.workspaceId, userId, 100, `ws-cap-${String(index)}`);
    }
    // 第四个用户自己的额度还很空,但工作区已经满了。
    const lateUser = uuidv7();
    await runtime.db.$client.query("INSERT INTO users (id, display_name) VALUES ($1, 'Capper')", [
      lateUser,
    ]);
    await expect(create(scope.workspaceId, lateUser, 1, "ws-cap-late")).rejects.toMatchObject({
      code: "IMPORT_QUEUE_LIMIT_REACHED",
    });
  });
});
