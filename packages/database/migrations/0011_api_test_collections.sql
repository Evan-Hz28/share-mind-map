-- 测试集合：把同步下来的套件组合成一个有名字、可保存的组，执行时整组跑成一批。
-- 套件本身由上游仓库同步维护，这里只存集合、成员关系和执行归属。

CREATE TABLE IF NOT EXISTS api_test_collections (
  id uuid PRIMARY KEY,
  name varchar(100) NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_test_collections_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT api_test_collections_name_ck CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS api_test_collections_name_uq
  ON api_test_collections (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS api_test_collection_suites (
  collection_id uuid NOT NULL,
  suite_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, suite_id),
  CONSTRAINT api_test_collection_suites_collection_fk
    FOREIGN KEY (collection_id) REFERENCES api_test_collections(id) ON DELETE CASCADE,
  CONSTRAINT api_test_collection_suites_suite_fk
    FOREIGN KEY (suite_id) REFERENCES api_test_suites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS api_test_collection_suites_suite_idx
  ON api_test_collection_suites (suite_id);

-- 记录这次执行是从哪个集合发起的，集合的「执行记录」按它查。
-- 散跑的批次没有集合，留空。
ALTER TABLE api_test_runs ADD COLUMN IF NOT EXISTS collection_id uuid;

ALTER TABLE api_test_runs DROP CONSTRAINT IF EXISTS api_test_runs_collection_fk;
ALTER TABLE api_test_runs
  ADD CONSTRAINT api_test_runs_collection_fk
  FOREIGN KEY (collection_id) REFERENCES api_test_collections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS api_test_runs_collection_idx
  ON api_test_runs (collection_id, created_at DESC, id DESC);
