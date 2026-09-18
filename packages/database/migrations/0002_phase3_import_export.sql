CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  total_jobs integer NOT NULL,
  uploaded_jobs integer NOT NULL DEFAULT 0,
  succeeded_jobs integer NOT NULL DEFAULT 0,
  failed_jobs integer NOT NULL DEFAULT 0,
  cancelled_jobs integer NOT NULL DEFAULT 0,
  expected_bytes bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT import_batches_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT import_batches_requested_by_fk FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT import_batches_status_ck CHECK (status IN ('pending', 'uploading', 'processing', 'succeeded', 'partial', 'failed', 'cancelled')),
  CONSTRAINT import_batches_total_jobs_ck CHECK (total_jobs > 0),
  CONSTRAINT import_batches_counters_ck CHECK (
    uploaded_jobs >= 0 AND succeeded_jobs >= 0 AND failed_jobs >= 0 AND cancelled_jobs >= 0
    AND uploaded_jobs <= total_jobs AND succeeded_jobs + failed_jobs + cancelled_jobs <= total_jobs
  ),
  CONSTRAINT import_batches_expected_bytes_ck CHECK (expected_bytes >= 0)
);
CREATE INDEX IF NOT EXISTS import_batches_workspace_created_idx
  ON import_batches (workspace_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  target_folder_id uuid,
  document_id uuid,
  client_file_name varchar(255) NOT NULL,
  target_name varchar(100) NOT NULL,
  target_name_normalized varchar(100) NOT NULL,
  phase varchar(20) NOT NULL DEFAULT 'waiting',
  compressed_bytes bigint,
  actual_bytes bigint,
  sha256 char(64),
  temp_object_key text,
  original_object_key text,
  compatibility_status varchar(20) NOT NULL DEFAULT 'full',
  compatibility_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code varchar(100),
  error_message text,
  attempt_count integer NOT NULL DEFAULT 0,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT import_jobs_batch_fk FOREIGN KEY (batch_id) REFERENCES import_batches(id),
  CONSTRAINT import_jobs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT import_jobs_requested_by_fk FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT import_jobs_folder_fk FOREIGN KEY (target_folder_id) REFERENCES folders(id),
  CONSTRAINT import_jobs_document_fk FOREIGN KEY (document_id) REFERENCES documents(id),
  CONSTRAINT import_jobs_phase_ck CHECK (phase IN ('waiting', 'uploading', 'parsing', 'persisting', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT import_jobs_target_name_ck CHECK (length(trim(target_name)) > 0),
  CONSTRAINT import_jobs_target_name_normalized_ck CHECK (length(trim(target_name_normalized)) > 0),
  CONSTRAINT import_jobs_bytes_ck CHECK (
    (compressed_bytes IS NULL OR compressed_bytes >= 0)
    AND (actual_bytes IS NULL OR actual_bytes >= 0)
  ),
  CONSTRAINT import_jobs_sha256_ck CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT import_jobs_compatibility_status_ck CHECK (compatibility_status IN ('full', 'partial', 'unsupported_online')),
  CONSTRAINT import_jobs_attempt_ck CHECK (attempt_count >= 0)
);
CREATE INDEX IF NOT EXISTS import_jobs_batch_created_idx
  ON import_jobs (batch_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS import_jobs_workspace_phase_idx
  ON import_jobs (workspace_id, phase, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_workspace_target_name_active_uq
  ON import_jobs (workspace_id, target_name_normalized)
  WHERE phase IN ('waiting', 'uploading', 'parsing', 'persisting', 'succeeded');
CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_workspace_sha256_active_uq
  ON import_jobs (workspace_id, sha256)
  WHERE sha256 IS NOT NULL AND phase IN ('waiting', 'uploading', 'parsing', 'persisting', 'succeeded');
CREATE UNIQUE INDEX IF NOT EXISTS documents_workspace_original_sha256_active_uq
  ON documents (workspace_id, original_sha256)
  WHERE original_sha256 IS NOT NULL AND trashed_at IS NULL;

CREATE TABLE IF NOT EXISTS document_assets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  document_id uuid NOT NULL,
  asset_kind varchar(20) NOT NULL,
  source_path text,
  object_key text,
  media_type varchar(100) NOT NULL,
  byte_size bigint NOT NULL,
  sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_assets_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT document_assets_document_fk FOREIGN KEY (document_id) REFERENCES documents(id),
  CONSTRAINT document_assets_kind_ck CHECK (asset_kind IN ('original', 'image')),
  CONSTRAINT document_assets_object_key_ck CHECK (object_key IS NOT NULL AND length(trim(object_key)) > 0),
  CONSTRAINT document_assets_byte_size_ck CHECK (byte_size > 0),
  CONSTRAINT document_assets_sha256_ck CHECK (sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT document_assets_media_type_ck CHECK (
    (asset_kind = 'original' AND media_type = 'application/xmind')
    OR (asset_kind = 'image' AND media_type IN ('image/png', 'image/jpeg', 'image/webp'))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS document_assets_original_uq
  ON document_assets (document_id)
  WHERE asset_kind = 'original';
CREATE UNIQUE INDEX IF NOT EXISTS document_assets_image_path_uq
  ON document_assets (document_id, source_path)
  WHERE asset_kind = 'image';
CREATE INDEX IF NOT EXISTS document_assets_workspace_document_idx
  ON document_assets (workspace_id, document_id, id);

CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  document_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  document_version bigint NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'waiting',
  object_key text,
  compatibility_status varchar(20) NOT NULL DEFAULT 'full',
  compatibility_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code varchar(100),
  error_message text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT export_jobs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT export_jobs_document_fk FOREIGN KEY (document_id) REFERENCES documents(id),
  CONSTRAINT export_jobs_requested_by_fk FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT export_jobs_version_ck CHECK (document_version > 0),
  CONSTRAINT export_jobs_status_ck CHECK (status IN ('waiting', 'exporting', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT export_jobs_compatibility_status_ck CHECK (compatibility_status IN ('full', 'partial', 'unsupported_online'))
);
CREATE INDEX IF NOT EXISTS export_jobs_workspace_created_idx
  ON export_jobs (workspace_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS export_jobs_expiry_idx
  ON export_jobs (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'succeeded';
