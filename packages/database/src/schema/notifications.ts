import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
  text,
} from "drizzle-orm/pg-core";

import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey(),
    eventKey: varchar("event_key", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    recipientUserId: uuid("recipient_user_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    targetType: varchar("target_type", { length: 100 }),
    targetId: uuid("target_id"),
    payload: jsonb("payload").notNull().default({}),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "notification_outbox_recipient_fk",
      columns: [table.recipientUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "notification_outbox_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    check(
      "notification_outbox_status_ck",
      sql`${table.status} IN ('pending', 'processing', 'delivered', 'failed')`,
    ),
    check("notification_outbox_attempt_ck", sql`${table.attemptCount} >= 0`),
    unique("notification_outbox_event_key_uq").on(table.eventKey),
    index("notification_outbox_ready_idx").on(table.status, table.availableAt, table.id),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    eventKey: varchar("event_key", { length: 255 }).notNull(),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    notificationType: varchar("notification_type", { length: 100 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    targetType: varchar("target_type", { length: 100 }),
    targetId: uuid("target_id"),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("notifications_event_key_uq").on(table.eventKey),
    foreignKey({
      name: "notifications_user_fk",
      columns: [table.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "notifications_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    index("notifications_user_read_created_idx").on(
      table.userId,
      table.readAt,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);
