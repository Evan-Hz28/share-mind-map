CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY,
  name varchar(100) NOT NULL,
  storage_quota_bytes bigint NOT NULL DEFAULT 10737418240,
  trash_retention_days integer NOT NULL DEFAULT 30,
  notification_retention_days integer NOT NULL DEFAULT 90,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_name_ck CHECK (length(trim(name)) > 0),
  CONSTRAINT organizations_storage_quota_ck CHECK (storage_quota_bytes > 0),
  CONSTRAINT organizations_retention_ck CHECK (trash_retention_days > 0 AND notification_retention_days > 0)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  name varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT workspaces_name_ck CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  display_name varchar(255) NOT NULL,
  avatar_url varchar(2048),
  account_status varchar(20) NOT NULL DEFAULT 'active',
  last_login_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT users_account_status_ck CHECK (account_status IN ('active', 'disabled'))
);

CREATE TABLE IF NOT EXISTS auth_identities (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  provider varchar(20) NOT NULL,
  provider_subject varchar(255) NOT NULL,
  login_name varchar(64),
  password_hash text,
  must_change_password boolean NOT NULL DEFAULT false,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_identities_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT auth_identities_user_fk FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT auth_identities_provider_ck CHECK (provider IN ('local', 'lark')),
  CONSTRAINT auth_identities_local_subject_normalized_ck CHECK (provider <> 'local' OR provider_subject = lower(provider_subject)),
  CONSTRAINT auth_identities_local_credentials_ck CHECK (provider <> 'local' OR (login_name IS NOT NULL AND password_hash IS NOT NULL)),
  CONSTRAINT auth_identities_non_local_password_ck CHECK (provider = 'local' OR password_hash IS NULL),
  CONSTRAINT auth_identities_org_provider_subject_uq UNIQUE (organization_id, provider, provider_subject),
  CONSTRAINT auth_identities_user_provider_uq UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_memberships_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT workspace_memberships_user_fk FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT workspace_memberships_granted_by_fk FOREIGN KEY (granted_by) REFERENCES users(id),
  CONSTRAINT workspace_memberships_role_ck CHECK (role IN ('reader', 'editor', 'admin')),
  CONSTRAINT workspace_memberships_status_ck CHECK (status IN ('active', 'revoked')),
  CONSTRAINT workspace_memberships_workspace_user_uq UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid,
  actor_user_id uuid,
  actor_session_id varchar(255),
  action varchar(100) NOT NULL,
  target_type varchar(100),
  target_id uuid,
  result varchar(20) NOT NULL,
  request_id varchar(64) NOT NULL,
  from_version bigint,
  to_version bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT audit_logs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT audit_logs_actor_user_fk FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT audit_logs_result_ck CHECK (result IN ('success', 'failure', 'denied')),
  CONSTRAINT audit_logs_action_ck CHECK (length(trim(action)) > 0)
);

CREATE INDEX IF NOT EXISTS auth_identities_org_subject_idx ON auth_identities (organization_id, provider_subject);
CREATE INDEX IF NOT EXISTS workspace_memberships_workspace_status_idx ON workspace_memberships (workspace_id, status);
CREATE INDEX IF NOT EXISTS audit_logs_organization_created_idx ON audit_logs (organization_id, created_at DESC);
