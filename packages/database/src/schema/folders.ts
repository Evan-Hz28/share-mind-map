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
  bigint,
} from "drizzle-orm/pg-core";

import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    parentId: uuid("parent_id"),
    name: varchar("name", { length: 50 }).notNull(),
    nameNormalized: varchar("name_normalized", { length: 50 }).notNull(),
    sortKey: bigint("sort_key", { mode: "number" }).notNull().default(0),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    trashedAt: timestamp("trashed_at", { withTimezone: true, mode: "date" }),
    trashEntryId: uuid("trash_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "folders_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    foreignKey({
      name: "folders_parent_fk",
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "folders_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "folders_updated_by_fk",
      columns: [table.updatedBy],
      foreignColumns: [users.id],
    }),
    check("folders_name_ck", sql`length(trim(${table.name})) > 0`),
    check("folders_name_normalized_ck", sql`length(trim(${table.nameNormalized})) > 0`),
    uniqueIndex("folders_workspace_parent_name_active_uq")
      .on(
        table.workspaceId,
        sql`coalesce(${table.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        table.nameNormalized,
      )
      .where(sql`${table.trashedAt} IS NULL`),
    index("folders_workspace_parent_sort_idx")
      .on(table.workspaceId, table.parentId, table.sortKey)
      .where(sql`${table.trashedAt} IS NULL`),
    index("folders_workspace_updated_idx")
      .on(table.workspaceId, table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.trashedAt} IS NULL`),
  ],
);
