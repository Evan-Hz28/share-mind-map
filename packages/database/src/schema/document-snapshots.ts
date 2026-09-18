import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users.js";
import { documents } from "./documents.js";

export const documentSnapshots = pgTable(
  "document_snapshots",
  {
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    schemaVersion: integer("schema_version").notNull(),
    snapshotJson: jsonb("snapshot_json"),
    snapshotObjectKey: text("snapshot_object_key"),
    snapshotSha256: char("snapshot_sha256", { length: 64 }).notNull(),
    nodeCount: integer("node_count").notNull(),
    saveKind: varchar("save_kind", { length: 20 }).notNull(),
    historyVisible: boolean("history_visible").notNull().default(false),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "document_snapshots_document_fk",
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }),
    foreignKey({
      name: "document_snapshots_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }),
    check("document_snapshots_version_ck", sql`${table.version} > 0`),
    check("document_snapshots_schema_version_ck", sql`${table.schemaVersion} > 0`),
    check(
      "document_snapshots_node_count_ck",
      sql`${table.nodeCount} > 0 AND ${table.nodeCount} <= 20000`,
    ),
    check(
      "document_snapshots_save_kind_ck",
      sql`${table.saveKind} IN ('initial', 'auto', 'manual', 'restore')`,
    ),
    check(
      "document_snapshots_storage_ck",
      sql`(${table.snapshotJson} IS NOT NULL) <> (${table.snapshotObjectKey} IS NOT NULL)`,
    ),
    check("document_snapshots_sha256_ck", sql`${table.snapshotSha256} ~ '^[0-9a-fA-F]{64}$'`),
    unique("document_snapshots_document_version_uq").on(table.documentId, table.version),
  ],
);
