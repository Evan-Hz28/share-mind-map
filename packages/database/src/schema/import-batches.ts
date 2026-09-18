import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    totalJobs: integer("total_jobs").notNull(),
    uploadedJobs: integer("uploaded_jobs").notNull().default(0),
    succeededJobs: integer("succeeded_jobs").notNull().default(0),
    failedJobs: integer("failed_jobs").notNull().default(0),
    cancelledJobs: integer("cancelled_jobs").notNull().default(0),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({
      name: "import_batches_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    foreignKey({
      name: "import_batches_requested_by_fk",
      columns: [table.requestedBy],
      foreignColumns: [users.id],
    }),
    check(
      "import_batches_status_ck",
      sql`${table.status} IN ('pending', 'uploading', 'processing', 'succeeded', 'partial', 'failed', 'cancelled')`,
    ),
    check("import_batches_total_jobs_ck", sql`${table.totalJobs} > 0`),
    check("import_batches_expected_bytes_ck", sql`${table.expectedBytes} >= 0`),
    index("import_batches_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);
