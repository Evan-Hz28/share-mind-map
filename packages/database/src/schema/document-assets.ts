import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { documents } from "./documents.js";
import { workspaces } from "./workspaces.js";

export const documentAssets = pgTable(
  "document_assets",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    documentId: uuid("document_id").notNull(),
    assetKind: varchar("asset_kind", { length: 20 }).notNull(),
    sourcePath: text("source_path"),
    objectKey: text("object_key").notNull(),
    mediaType: varchar("media_type", { length: 100 }).notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "document_assets_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    foreignKey({
      name: "document_assets_document_fk",
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }),
    check("document_assets_kind_ck", sql`${table.assetKind} IN ('original', 'image')`),
    check("document_assets_byte_size_ck", sql`${table.byteSize} > 0`),
    check("document_assets_sha256_ck", sql`${table.sha256} ~ '^[0-9a-fA-F]{64}$'`),
    check(
      "document_assets_media_type_ck",
      sql`(${table.assetKind} = 'original' AND ${table.mediaType} = 'application/xmind') OR (${table.assetKind} = 'image' AND ${table.mediaType} IN ('image/png', 'image/jpeg', 'image/webp'))`,
    ),
    uniqueIndex("document_assets_original_uq")
      .on(table.documentId)
      .where(sql`${table.assetKind} = 'original'`),
    uniqueIndex("document_assets_image_path_uq")
      .on(table.documentId, table.sourcePath)
      .where(sql`${table.assetKind} = 'image'`),
    index("document_assets_workspace_document_idx").on(
      table.workspaceId,
      table.documentId,
      table.id,
    ),
    index("document_assets_workspace_sha_idx").on(table.workspaceId, table.sha256, table.id),
  ],
);
