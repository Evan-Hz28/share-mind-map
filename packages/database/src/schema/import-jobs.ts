import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { documents } from "./documents.js";
import { folders } from "./folders.js";
import { importBatches } from "./import-batches.js";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey(),
    batchId: uuid("batch_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    targetFolderId: uuid("target_folder_id"),
    documentId: uuid("document_id"),
    clientFileName: varchar("client_file_name", { length: 255 }).notNull(),
    targetName: varchar("target_name", { length: 100 }).notNull(),
    targetNameNormalized: varchar("target_name_normalized", { length: 100 }).notNull(),
    phase: varchar("phase", { length: 20 }).notNull().default("waiting"),
    compressedBytes: bigint("compressed_bytes", { mode: "number" }),
    actualBytes: bigint("actual_bytes", { mode: "number" }),
    sha256: char("sha256", { length: 64 }),
    tempObjectKey: text("temp_object_key"),
    originalObjectKey: text("original_object_key"),
    compatibilityStatus: varchar("compatibility_status", { length: 20 }).notNull().default("full"),
    compatibilityReport: jsonb("compatibility_report").notNull().default({}),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({
      name: "import_jobs_batch_fk",
      columns: [table.batchId],
      foreignColumns: [importBatches.id],
    }),
    foreignKey({
      name: "import_jobs_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    foreignKey({
      name: "import_jobs_requested_by_fk",
      columns: [table.requestedBy],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "import_jobs_folder_fk",
      columns: [table.targetFolderId],
      foreignColumns: [folders.id],
    }),
    foreignKey({
      name: "import_jobs_document_fk",
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }),
    check(
      "import_jobs_phase_ck",
      sql`${table.phase} IN ('waiting', 'uploading', 'parsing', 'persisting', 'succeeded', 'failed', 'cancelled')`,
    ),
    check("import_jobs_target_name_ck", sql`length(trim(${table.targetName})) > 0`),
    check(
      "import_jobs_target_name_normalized_ck",
      sql`length(trim(${table.targetNameNormalized})) > 0`,
    ),
    check("import_jobs_attempt_ck", sql`${table.attemptCount} >= 0`),
    index("import_jobs_batch_created_idx").on(table.batchId, table.createdAt.asc(), table.id.asc()),
    index("import_jobs_workspace_phase_idx").on(
      table.workspaceId,
      table.phase,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    uniqueIndex("import_jobs_workspace_target_name_active_uq")
      .on(table.workspaceId, table.targetNameNormalized)
      .where(sql`${table.phase} IN ('waiting', 'uploading', 'parsing', 'persisting', 'succeeded')`),
    uniqueIndex("import_jobs_workspace_sha256_active_uq")
      .on(table.workspaceId, table.sha256)
      .where(
        sql`${table.sha256} IS NOT NULL AND ${table.phase} IN ('waiting', 'uploading', 'parsing', 'persisting', 'succeeded')`,
      ),
  ],
);
