import { sql } from "drizzle-orm";
import {
  bigint,
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

import { users } from "./users.js";
import { workspaces } from "./workspaces.js";
import { folders } from "./folders.js";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    folderId: uuid("folder_id"),
    name: varchar("name", { length: 100 }).notNull(),
    nameNormalized: varchar("name_normalized", { length: 100 }).notNull(),
    currentVersion: bigint("current_version", { mode: "number" }).notNull().default(1),
    schemaVersion: integer("schema_version").notNull().default(1),
    currentSnapshotId: uuid("current_snapshot_id"),
    originalObjectKey: text("original_object_key"),
    originalSha256: char("original_sha256", { length: 64 }),
    compatibilityStatus: varchar("compatibility_status", { length: 20 }).notNull().default("full"),
    compatibilityReport: jsonb("compatibility_report").notNull().default({}),
    nodeCount: integer("node_count").notNull().default(1),
    imageBytes: bigint("image_bytes", { mode: "number" }).notNull().default(0),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    trashedAt: timestamp("trashed_at", { withTimezone: true, mode: "date" }),
    trashEntryId: uuid("trash_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "documents_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    foreignKey({
      name: "documents_folder_fk",
      columns: [table.folderId],
      foreignColumns: [folders.id],
    }),
    foreignKey({
      name: "documents_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "documents_updated_by_fk",
      columns: [table.updatedBy],
      foreignColumns: [users.id],
    }),
    check("documents_name_ck", sql`length(trim(${table.name})) > 0`),
    check("documents_name_normalized_ck", sql`length(trim(${table.nameNormalized})) > 0`),
    check("documents_version_ck", sql`${table.currentVersion} > 0`),
    check("documents_schema_version_ck", sql`${table.schemaVersion} > 0`),
    check("documents_node_count_ck", sql`${table.nodeCount} > 0 AND ${table.nodeCount} <= 20000`),
    check(
      "documents_image_bytes_ck",
      sql`${table.imageBytes} >= 0 AND ${table.imageBytes} <= 52428800`,
    ),
    check(
      "documents_compatibility_status_ck",
      sql`${table.compatibilityStatus} IN ('full', 'partial', 'unsupported_online')`,
    ),
    uniqueIndex("documents_workspace_name_active_uq")
      .on(table.workspaceId, table.nameNormalized)
      .where(sql`${table.trashedAt} IS NULL`),
    index("documents_workspace_updated_idx")
      .on(table.workspaceId, table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.trashedAt} IS NULL`),
    index("documents_folder_updated_idx")
      .on(table.folderId, table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.trashedAt} IS NULL`),
  ],
);
