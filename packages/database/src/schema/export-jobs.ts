import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { documents } from "./documents.js";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    documentId: uuid("document_id").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    documentVersion: bigint("document_version", { mode: "number" }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("waiting"),
    objectKey: text("object_key"),
    compatibilityStatus: varchar("compatibility_status", { length: 20 }).notNull().default("full"),
    compatibilityReport: jsonb("compatibility_report").notNull().default({}),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({
      name: "export_jobs_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    foreignKey({
      name: "export_jobs_document_fk",
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }),
    foreignKey({
      name: "export_jobs_requested_by_fk",
      columns: [table.requestedBy],
      foreignColumns: [users.id],
    }),
    check("export_jobs_version_ck", sql`${table.documentVersion} > 0`),
    check(
      "export_jobs_status_ck",
      sql`${table.status} IN ('waiting', 'exporting', 'succeeded', 'failed', 'cancelled')`,
    ),
    check(
      "export_jobs_compatibility_status_ck",
      sql`${table.compatibilityStatus} IN ('full', 'partial', 'unsupported_online')`,
    ),
    index("export_jobs_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("export_jobs_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} IS NOT NULL AND ${table.status} = 'succeeded'`),
  ],
);
