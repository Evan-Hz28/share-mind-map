import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    provider: varchar("provider", { length: 20 }).notNull(),
    providerSubject: varchar("provider_subject", { length: 255 }).notNull(),
    loginName: varchar("login_name", { length: 64 }),
    passwordHash: text("password_hash"),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "auth_identities_organization_fk",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: "auth_identities_user_fk",
      columns: [table.userId],
      foreignColumns: [users.id],
    }),
    check("auth_identities_provider_ck", sql`${table.provider} IN ('local', 'lark')`),
    check(
      "auth_identities_local_subject_normalized_ck",
      sql`${table.provider} <> 'local' OR ${table.providerSubject} = lower(${table.providerSubject})`,
    ),
    check(
      "auth_identities_local_credentials_ck",
      sql`${table.provider} <> 'local' OR (${table.loginName} IS NOT NULL AND ${table.passwordHash} IS NOT NULL)`,
    ),
    check(
      "auth_identities_non_local_password_ck",
      sql`${table.provider} = 'local' OR ${table.passwordHash} IS NULL`,
    ),
    unique("auth_identities_org_provider_subject_uq").on(
      table.organizationId,
      table.provider,
      table.providerSubject,
    ),
    unique("auth_identities_user_provider_uq").on(table.userId, table.provider),
    index("auth_identities_org_subject_idx").on(table.organizationId, table.providerSubject),
  ],
);
