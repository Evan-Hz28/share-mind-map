import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import type { Database } from "./client.js";

const advisoryLockKey = 4_839_172_061n;

interface MigrationFile {
  name: string;
  path: URL;
  createdAt: number;
}

async function migrationFiles(): Promise<MigrationFile[]> {
  const directory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  return names.map((filename, index) => ({
    name: filename.slice(0, -4),
    path: new URL(filename, directory),
    createdAt: index,
  }));
}

export async function migrateDatabase(database: Database): Promise<void> {
  const migrations = await migrationFiles();
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
    for (const migration of migrations) {
      const existing = await client.query<{ name: string }>(
        "SELECT name FROM drizzle.__drizzle_migrations WHERE name = $1",
        [migration.name],
      );
      if (existing.rowCount !== 0) continue;
      const migrationSql = await readFile(migration.path, "utf8");
      await client.query(migrationSql);
      await client.query(
        "INSERT INTO drizzle.__drizzle_migrations (name, hash, created_at) VALUES ($1, $2, $3)",
        [
          migration.name,
          createHash("sha256").update(migrationSql).digest("hex"),
          migration.createdAt,
        ],
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
