import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { organizations } from "./organizations.js";

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "workspaces_organization_fk",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }),
    check("workspaces_name_ck", sql`length(trim(${table.name})) > 0`),
  ],
);
