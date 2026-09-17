import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    avatarUrl: varchar("avatar_url", { length: 2048 }),
    accountStatus: varchar("account_status", { length: 20 }).notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "users_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [table.id],
    }),
    check("users_account_status_ck", sql`${table.accountStatus} IN ('active', 'disabled')`),
  ],
);
