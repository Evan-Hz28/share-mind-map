-- 用例仓库改为运行时从上游 git 拉取（kitarkitar/api-test），套件按目录自动发现。
-- 之前每个模块一条手写 suite 的做法废弃：套件由同步任务按 testcases 下的目录 upsert。

CREATE TABLE IF NOT EXISTS api_test_syncs (
  id uuid PRIMARY KEY,
  branch varchar(100) NOT NULL DEFAULT 'main',
  status varchar(20) NOT NULL DEFAULT 'queued',
  trigger varchar(20) NOT NULL DEFAULT 'manual',
  requested_by uuid,
  commit_sha varchar(64),
  previous_sha varchar(64),
  changed_files integer NOT NULL DEFAULT 0,
  suites_added integer NOT NULL DEFAULT 0,
  suites_removed integer NOT NULL DEFAULT 0,
  requirements_changed boolean NOT NULL DEFAULT false,
  message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_test_syncs_requested_by_fk FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT api_test_syncs_status_ck CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT api_test_syncs_trigger_ck CHECK (trigger IN ('manual', 'webhook'))
);
CREATE INDEX IF NOT EXISTS api_test_syncs_created_idx
  ON api_test_syncs (created_at DESC, id DESC);

-- 每次执行记录它实际跑的 commit，报告才能对应到具体代码版本。
ALTER TABLE api_test_runs ADD COLUMN IF NOT EXISTS repo_commit varchar(64);

-- discovered=true 的行由同步任务维护：仓库里消失就停用，重新出现再启用。
ALTER TABLE api_test_suites ADD COLUMN IF NOT EXISTS discovered boolean NOT NULL DEFAULT false;
ALTER TABLE api_test_suites ADD COLUMN IF NOT EXISTS last_seen_commit varchar(64);

-- 套件以仓库相对路径为准，同一路径只能有一条。
DELETE FROM api_test_suites a
USING api_test_suites b
WHERE a.path = b.path
  AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS api_test_suites_path_uq ON api_test_suites (path);

-- 已有的手写套件路径与仓库一致，交给同步任务接管。
UPDATE api_test_suites SET discovered = true;
