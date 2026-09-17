import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    grantedBy: uuid("granted_by"),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "workspace_memberships_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    foreignKey({
      name: "workspace_memberships_user_fk",
      columns: [table.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "workspace_memberships_granted_by_fk",
      columns: [table.grantedBy],
      foreignColumns: [users.id],
    }),
    check("workspace_memberships_role_ck", sql`${table.role} IN ('reader', 'editor', 'admin')`),
    check("workspace_memberships_status_ck", sql`${table.status} IN ('active', 'revoked')`),
    unique("workspace_memberships_workspace_user_uq").on(table.workspaceId, table.userId),
    index("workspace_memberships_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);
