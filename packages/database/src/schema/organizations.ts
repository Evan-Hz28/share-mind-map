import { sql } from "drizzle-orm";
import { bigint, check, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" })
      .notNull()
      .default(10_737_418_240),
    trashRetentionDays: integer("trash_retention_days").notNull().default(30),
    notificationRetentionDays: integer("notification_retention_days").notNull().default(90),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    check("organizations_name_ck", sql`length(trim(${table.name})) > 0`),
    check("organizations_storage_quota_ck", sql`${table.storageQuotaBytes} > 0`),
    check(
      "organizations_retention_ck",
      sql`${table.trashRetentionDays} > 0 AND ${table.notificationRetentionDays} > 0`,
    ),
  ],
);
