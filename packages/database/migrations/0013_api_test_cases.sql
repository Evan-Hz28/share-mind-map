-- 用例编目：测试集（目录）下面再细分到文件和函数。
-- 上游仓库是唯一真源，同步任务按 AST 静态扫描后 upsert；仓库里消失的行停用，不删除，
-- 这样历史执行记录、已保存的集合和定时任务都还能解释自己指向的是什么。

CREATE TABLE IF NOT EXISTS api_test_cases (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL,
  node_id text NOT NULL,
  file_path text NOT NULL,
  name text NOT NULL,
  kind varchar(8) NOT NULL,
  ordinal integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  discovered boolean NOT NULL DEFAULT true,
  last_seen_commit varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_test_cases_suite_fk FOREIGN KEY (suite_id) REFERENCES api_test_suites(id) ON DELETE CASCADE,
  CONSTRAINT api_test_cases_node_ck CHECK (length(btrim(node_id)) > 0),
  CONSTRAINT api_test_cases_kind_ck CHECK (kind IN ('file', 'case')),
  CONSTRAINT api_test_cases_suite_node_uq UNIQUE (suite_id, node_id),
  -- 集合成员用 (case_id, suite_id) 复合外键，保证用例确实属于声明的测试集。
  CONSTRAINT api_test_cases_id_suite_uq UNIQUE (id, suite_id)
);

CREATE INDEX IF NOT EXISTS api_test_cases_suite_idx
  ON api_test_cases (suite_id, file_path, ordinal, id);

-- 集合成员从「只能放测试集」放宽到「测试集或单个用例」，并保留整体顺序。
CREATE TABLE IF NOT EXISTS api_test_collection_items (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL,
  suite_id uuid NOT NULL,
  case_id uuid,
  position integer NOT NULL DEFAULT 0,
  CONSTRAINT api_test_collection_items_collection_fk
    FOREIGN KEY (collection_id) REFERENCES api_test_collections(id) ON DELETE CASCADE,
  CONSTRAINT api_test_collection_items_suite_fk
    FOREIGN KEY (suite_id) REFERENCES api_test_suites(id) ON DELETE CASCADE,
  CONSTRAINT api_test_collection_items_case_fk
    FOREIGN KEY (case_id, suite_id)
    REFERENCES api_test_cases(id, suite_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS api_test_collection_items_suite_uq
  ON api_test_collection_items (collection_id, suite_id)
  WHERE case_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS api_test_collection_items_case_uq
  ON api_test_collection_items (collection_id, case_id)
  WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS api_test_collection_items_position_idx
  ON api_test_collection_items (collection_id, position, id);

-- 老集合全部是整测试集成员，原样搬过去。
INSERT INTO api_test_collection_items (id, collection_id, suite_id, case_id, position)
SELECT gen_random_uuid(), collection_id, suite_id, NULL, position
FROM api_test_collection_suites
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS api_test_collection_suites;

-- 同步结果里补上用例数量，方便判断这次同步到底动了什么。
ALTER TABLE api_test_syncs ADD COLUMN IF NOT EXISTS cases_added integer NOT NULL DEFAULT 0;
ALTER TABLE api_test_syncs ADD COLUMN IF NOT EXISTS cases_removed integer NOT NULL DEFAULT 0;
