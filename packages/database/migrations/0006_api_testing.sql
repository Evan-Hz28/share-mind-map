CREATE TABLE IF NOT EXISTS api_test_environments (
  id uuid PRIMARY KEY,
  key varchar(32) NOT NULL,
  name varchar(100) NOT NULL,
  base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_test_environments_key_uq UNIQUE (key),
  CONSTRAINT api_test_environments_base_url_ck CHECK (base_url ~ '^https?://')
);

CREATE TABLE IF NOT EXISTS api_test_suites (
  id uuid PRIMARY KEY,
  key varchar(64) NOT NULL,
  name varchar(100) NOT NULL,
  path text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_test_suites_key_uq UNIQUE (key),
  CONSTRAINT api_test_suites_path_ck CHECK (length(trim(path)) > 0)
);

CREATE TABLE IF NOT EXISTS api_test_runs (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  mode varchar(20) NOT NULL DEFAULT 'suite',
  selection jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'queued',
  cancel_requested boolean NOT NULL DEFAULT false,
  total_count integer NOT NULL DEFAULT 0,
  passed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT api_test_runs_suite_fk FOREIGN KEY (suite_id) REFERENCES api_test_suites(id),
  CONSTRAINT api_test_runs_environment_fk FOREIGN KEY (environment_id) REFERENCES api_test_environments(id),
  CONSTRAINT api_test_runs_requested_by_fk FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT api_test_runs_mode_ck CHECK (mode IN ('suite', 'selected')),
  CONSTRAINT api_test_runs_status_ck CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS api_test_runs_created_idx
  ON api_test_runs (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS api_test_run_items (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  node_id text NOT NULL,
  case_name text NOT NULL,
  ordinal integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL,
  duration_ms integer,
  failure text,
  request jsonb,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_test_run_items_run_fk FOREIGN KEY (run_id) REFERENCES api_test_runs(id) ON DELETE CASCADE,
  CONSTRAINT api_test_run_items_status_ck CHECK (status IN ('passed', 'failed', 'skipped', 'error')),
  CONSTRAINT api_test_run_items_run_node_uq UNIQUE (run_id, node_id)
);
CREATE INDEX IF NOT EXISTS api_test_run_items_run_ordinal_idx
  ON api_test_run_items (run_id, ordinal, id);

INSERT INTO api_test_environments (id, key, name, base_url)
VALUES
  ('01900000-0000-7000-8000-000000000301', 'api', 'API (api.kitarx.com)', 'https://api.kitarx.com'),
  ('01900000-0000-7000-8000-000000000302', 'ydq', 'ydq (ydqapi.kitarx.com)', 'https://ydqapi.kitarx.com'),
  ('01900000-0000-7000-8000-000000000303', 'cjy', 'cjy (cjyapi.kitarx.com)', 'https://cjyapi.kitarx.com')
ON CONFLICT (key) DO NOTHING;

INSERT INTO api_test_suites (id, key, name, path)
VALUES
  ('01900000-0000-7000-8000-000000000401', 'v3-basic', 'v3 基础', 'testcases/v3_基础')
ON CONFLICT (key) DO NOTHING;
