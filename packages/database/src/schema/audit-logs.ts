import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    workspaceId: uuid("workspace_id"),
    actorUserId: uuid("actor_user_id"),
    actorSessionId: varchar("actor_session_id", { length: 255 }),
    action: varchar("action", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 100 }),
    targetId: uuid("target_id"),
    result: varchar("result", { length: 20 }).notNull(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    fromVersion: bigint("from_version", { mode: "number" }),
    toVersion: bigint("to_version", { mode: "number" }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "audit_logs_organization_fk",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: "audit_logs_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    foreignKey({
      name: "audit_logs_actor_user_fk",
      columns: [table.actorUserId],
      foreignColumns: [users.id],
    }),
    check("audit_logs_result_ck", sql`${table.result} IN ('success', 'failure', 'denied')`),
    check("audit_logs_action_ck", sql`length(trim(${table.action})) > 0`),
    index("audit_logs_organization_created_idx").on(table.organizationId, table.createdAt.desc()),
  ],
);
