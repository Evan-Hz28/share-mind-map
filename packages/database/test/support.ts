import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { createDatabase, type Database } from "../src/index.js";

export interface DatabaseTestRuntime {
  container: StartedPostgreSqlContainer;
  db: Database;
}

export async function startDatabaseTestRuntime(): Promise<DatabaseTestRuntime> {
  const container = await new PostgreSqlContainer("postgres:17.6-alpine3.22")
    .withDatabase("share_mind_map_test")
    .withUsername("mindmap_test")
    .withPassword("local-test-password")
    .start();
  return {
    container,
    db: createDatabase(container.getConnectionUri()),
  };
}

export async function stopDatabaseTestRuntime(runtime?: DatabaseTestRuntime): Promise<void> {
  if (runtime === undefined) return;
  await runtime.db.$client.end();
  await runtime.container.stop();
}

export async function resetDatabase(runtime: DatabaseTestRuntime): Promise<void> {
  await runtime.db.$client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await runtime.db.$client.query("DROP SCHEMA public CASCADE");
  await runtime.db.$client.query("CREATE SCHEMA public");
}
