import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const editPermissionRequests = pgTable(
  "edit_permission_requests",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    requesterId: uuid("requester_id").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "edit_permission_requests_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    foreignKey({
      name: "edit_permission_requests_requester_fk",
      columns: [table.requesterId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "edit_permission_requests_decided_by_fk",
      columns: [table.decidedBy],
      foreignColumns: [users.id],
    }),
    check(
      "edit_permission_requests_status_ck",
      sql`${table.status} IN ('pending', 'approved', 'rejected')`,
    ),
    uniqueIndex("edit_permission_requests_pending_uq")
      .on(table.workspaceId, table.requesterId)
      .where(sql`${table.status} = 'pending'`),
    index("edit_permission_requests_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.requestedAt.desc(),
      table.id.desc(),
    ),
  ],
);
