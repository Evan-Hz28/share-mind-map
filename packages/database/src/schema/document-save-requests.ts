import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { documentSnapshots } from "./document-snapshots.js";
import { documents } from "./documents.js";

export const documentSaveRequests = pgTable(
  "document_save_requests",
  {
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    baseVersion: bigint("base_version", { mode: "number" }).notNull(),
    snapshotSha256: char("snapshot_sha256", { length: 64 }).notNull(),
    resultingSnapshotId: uuid("resulting_snapshot_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "document_save_requests_document_fk",
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_save_requests_snapshot_fk",
      columns: [table.resultingSnapshotId],
      foreignColumns: [documentSnapshots.id],
    }).onDelete("cascade"),
    check("document_save_requests_key_ck", sql`length(trim(${table.idempotencyKey})) > 0`),
    check("document_save_requests_version_ck", sql`${table.baseVersion} > 0`),
    check("document_save_requests_sha256_ck", sql`${table.snapshotSha256} ~ '^[0-9a-fA-F]{64}$'`),
    unique("document_save_requests_document_key_uq").on(table.documentId, table.idempotencyKey),
    index("document_save_requests_document_created_idx").on(
      table.documentId,
      table.createdAt.desc(),
    ),
  ],
);
