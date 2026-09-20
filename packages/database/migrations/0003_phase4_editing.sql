CREATE TABLE IF NOT EXISTS snapshot_asset_refs (
  snapshot_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  CONSTRAINT snapshot_asset_refs_pkey PRIMARY KEY (snapshot_id, asset_id),
  CONSTRAINT snapshot_asset_refs_snapshot_fk
    FOREIGN KEY (snapshot_id) REFERENCES document_snapshots(id) ON DELETE CASCADE,
  CONSTRAINT snapshot_asset_refs_asset_fk
    FOREIGN KEY (asset_id) REFERENCES document_assets(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS snapshot_asset_refs_asset_idx
  ON snapshot_asset_refs (asset_id, snapshot_id);

CREATE OR REPLACE FUNCTION enforce_snapshot_asset_document_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM document_snapshots AS snapshots
    INNER JOIN document_assets AS assets
      ON assets.document_id = snapshots.document_id
    WHERE snapshots.id = NEW.snapshot_id
      AND assets.id = NEW.asset_id
  ) THEN
    RAISE EXCEPTION 'Snapshot and asset must belong to the same document.'
      USING ERRCODE = '23514', CONSTRAINT = 'snapshot_asset_refs_document_asset_ck';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_asset_refs_document_asset_trg ON snapshot_asset_refs;
CREATE CONSTRAINT TRIGGER snapshot_asset_refs_document_asset_trg
AFTER INSERT OR UPDATE ON snapshot_asset_refs
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION enforce_snapshot_asset_document_match();

CREATE TABLE IF NOT EXISTS document_save_requests (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  base_version bigint NOT NULL,
  snapshot_sha256 char(64) NOT NULL,
  resulting_snapshot_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_save_requests_document_fk
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT document_save_requests_snapshot_fk
    FOREIGN KEY (resulting_snapshot_id) REFERENCES document_snapshots(id) ON DELETE CASCADE,
  CONSTRAINT document_save_requests_key_ck CHECK (length(trim(idempotency_key)) > 0),
  CONSTRAINT document_save_requests_version_ck CHECK (base_version > 0),
  CONSTRAINT document_save_requests_sha256_ck CHECK (snapshot_sha256 ~ '^[0-9a-fA-F]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS document_save_requests_document_key_uq
  ON document_save_requests (document_id, idempotency_key);

CREATE INDEX IF NOT EXISTS document_assets_workspace_sha_idx
  ON document_assets (workspace_id, sha256, id);
