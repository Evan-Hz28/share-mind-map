import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Database } from "./client.js";

const migrationName = "0000_phase1_identity";
const migrationCreatedAt = 0;
const advisoryLockKey = 4_839_172_061n;

export async function migrateDatabase(database: Database): Promise<void> {
  const sql = await readFile(
    new URL(`../migrations/${migrationName}.sql`, import.meta.url),
    "utf8",
  );
  const client = await database.$client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [advisoryLockKey]);
    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query(
      `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
         id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         name text UNIQUE,
         hash text NOT NULL,
         created_at bigint NOT NULL
        )`,
    );
    const existing = await client.query<{ name: string }>(
      "SELECT name FROM drizzle.__drizzle_migrations WHERE name = $1",
      [migrationName],
    );
    if (existing.rowCount === 0) {
      await client.query(sql);
      await client.query(
        "INSERT INTO drizzle.__drizzle_migrations (name, hash, created_at) VALUES ($1, $2, $3)",
        [migrationName, createHash("sha256").update(sql).digest("hex"), migrationCreatedAt],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
