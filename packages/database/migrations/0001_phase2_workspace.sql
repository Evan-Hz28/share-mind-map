CREATE TABLE IF NOT EXISTS edit_permission_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  requester_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT edit_permission_requests_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT edit_permission_requests_requester_fk FOREIGN KEY (requester_id) REFERENCES users(id),
  CONSTRAINT edit_permission_requests_decided_by_fk FOREIGN KEY (decided_by) REFERENCES users(id),
  CONSTRAINT edit_permission_requests_status_ck CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT edit_permission_requests_decision_ck CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('approved', 'rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS edit_permission_requests_pending_uq
  ON edit_permission_requests (workspace_id, requester_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS edit_permission_requests_workspace_status_idx
  ON edit_permission_requests (workspace_id, status, requested_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS folders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  name varchar(50) NOT NULL,
  name_normalized varchar(50) NOT NULL,
  sort_key bigint NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  trashed_at timestamptz,
  trash_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT folders_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT folders_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT folders_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT folders_name_ck CHECK (length(trim(name)) > 0),
  CONSTRAINT folders_name_normalized_ck CHECK (length(trim(name_normalized)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS folders_workspace_name_active_uq
  ON folders (workspace_id, name_normalized)
  WHERE trashed_at IS NULL;
CREATE INDEX IF NOT EXISTS folders_workspace_updated_idx
  ON folders (workspace_id, updated_at DESC, id DESC)
  WHERE trashed_at IS NULL;

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  folder_id uuid,
  name varchar(100) NOT NULL,
  name_normalized varchar(100) NOT NULL,
  current_version bigint NOT NULL DEFAULT 1,
  schema_version integer NOT NULL DEFAULT 1,
  current_snapshot_id uuid,
  original_object_key text,
  original_sha256 char(64),
  compatibility_status varchar(20) NOT NULL DEFAULT 'full',
  compatibility_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  node_count integer NOT NULL DEFAULT 1,
  image_bytes bigint NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  trashed_at timestamptz,
  trash_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT documents_folder_fk FOREIGN KEY (folder_id) REFERENCES folders(id),
  CONSTRAINT documents_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT documents_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT documents_name_ck CHECK (length(trim(name)) > 0),
  CONSTRAINT documents_name_normalized_ck CHECK (length(trim(name_normalized)) > 0),
  CONSTRAINT documents_version_ck CHECK (current_version > 0),
  CONSTRAINT documents_schema_version_ck CHECK (schema_version > 0),
  CONSTRAINT documents_node_count_ck CHECK (node_count > 0 AND node_count <= 20000),
  CONSTRAINT documents_image_bytes_ck CHECK (image_bytes >= 0 AND image_bytes <= 52428800),
  CONSTRAINT documents_compatibility_status_ck CHECK (compatibility_status IN ('full', 'partial', 'unsupported_online'))
);

CREATE UNIQUE INDEX IF NOT EXISTS documents_workspace_name_active_uq
  ON documents (workspace_id, name_normalized)
  WHERE trashed_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_workspace_updated_idx
  ON documents (workspace_id, updated_at DESC, id DESC)
  WHERE trashed_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_folder_updated_idx
  ON documents (folder_id, updated_at DESC, id DESC)
  WHERE trashed_at IS NULL;

CREATE TABLE IF NOT EXISTS document_snapshots (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL,
  version bigint NOT NULL,
  schema_version integer NOT NULL,
  snapshot_json jsonb,
  snapshot_object_key text,
  snapshot_sha256 char(64) NOT NULL,
  node_count integer NOT NULL,
  save_kind varchar(20) NOT NULL,
  history_visible boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_snapshots_document_fk FOREIGN KEY (document_id) REFERENCES documents(id),
  CONSTRAINT document_snapshots_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT document_snapshots_version_ck CHECK (version > 0),
  CONSTRAINT document_snapshots_node_count_ck CHECK (node_count > 0 AND node_count <= 20000),
  CONSTRAINT document_snapshots_save_kind_ck CHECK (save_kind IN ('initial', 'auto', 'manual', 'restore')),
  CONSTRAINT document_snapshots_storage_ck CHECK ((snapshot_json IS NOT NULL) <> (snapshot_object_key IS NOT NULL)),
  CONSTRAINT document_snapshots_sha256_ck CHECK (snapshot_sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT document_snapshots_document_version_uq UNIQUE (document_id, version)
);

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_current_snapshot_fk;
ALTER TABLE documents
  ADD CONSTRAINT documents_current_snapshot_fk FOREIGN KEY (current_snapshot_id) REFERENCES document_snapshots(id);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY,
  event_key varchar(255) NOT NULL,
  event_type varchar(100) NOT NULL,
  recipient_user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  target_type varchar(100),
  target_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_recipient_fk FOREIGN KEY (recipient_user_id) REFERENCES users(id),
  CONSTRAINT notification_outbox_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT notification_outbox_status_ck CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  CONSTRAINT notification_outbox_attempt_ck CHECK (attempt_count >= 0),
  CONSTRAINT notification_outbox_event_key_uq UNIQUE (event_key)
);
CREATE INDEX IF NOT EXISTS notification_outbox_ready_idx
  ON notification_outbox (status, available_at, id);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  event_key varchar(255) NOT NULL,
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  notification_type varchar(100) NOT NULL,
  title varchar(255) NOT NULL,
  body text NOT NULL,
  target_type varchar(100),
  target_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT notifications_event_key_uq UNIQUE (event_key),
  CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT notifications_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);
CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
  ON notifications (user_id, read_at, created_at DESC, id DESC);
