import { foreignKey, index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";

import { documentAssets } from "./document-assets.js";
import { documentSnapshots } from "./document-snapshots.js";

export const snapshotAssetRefs = pgTable(
  "snapshot_asset_refs",
  {
    snapshotId: uuid("snapshot_id").notNull(),
    assetId: uuid("asset_id").notNull(),
  },
  (table) => [
    primaryKey({ name: "snapshot_asset_refs_pkey", columns: [table.snapshotId, table.assetId] }),
    foreignKey({
      name: "snapshot_asset_refs_snapshot_fk",
      columns: [table.snapshotId],
      foreignColumns: [documentSnapshots.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "snapshot_asset_refs_asset_fk",
      columns: [table.assetId],
      foreignColumns: [documentAssets.id],
    }).onDelete("restrict"),
    index("snapshot_asset_refs_asset_idx").on(table.assetId, table.snapshotId),
  ],
);
