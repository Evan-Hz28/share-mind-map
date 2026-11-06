-- 定时调度：按固定 cron 周期自动执行单个测试集或整个测试集合。
-- 这张表是真源；Redis 里的 BullMQ Job Scheduler 只是执行副本，worker 启动时按本表重建。

CREATE TABLE IF NOT EXISTS api_test_schedules (
  id uuid PRIMARY KEY,
  name varchar(100) NOT NULL,
  target_type varchar(20) NOT NULL,
  target_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  cron varchar(100) NOT NULL,
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  sync_before_run boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_batch_id uuid,
  last_run_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_test_schedules_name_ck CHECK (length(btrim(name)) > 0),
  CONSTRAINT api_test_schedules_target_type_ck CHECK (target_type IN ('suite', 'collection')),
  CONSTRAINT api_test_schedules_environment_fk
    FOREIGN KEY (environment_id) REFERENCES api_test_environments(id),
  CONSTRAINT api_test_schedules_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS api_test_schedules_name_uq
  ON api_test_schedules (lower(btrim(name)));

CREATE INDEX IF NOT EXISTS api_test_schedules_due_idx
  ON api_test_schedules (enabled, next_run_at);

-- 定时任务执行前触发的同步要能和手动同步区分开。
ALTER TABLE api_test_syncs DROP CONSTRAINT IF EXISTS api_test_syncs_trigger_ck;
ALTER TABLE api_test_syncs
  ADD CONSTRAINT api_test_syncs_trigger_ck CHECK (trigger IN ('manual', 'webhook', 'schedule'));

-- 集合被删时连带删掉针对它的定时任务；测试集用 ON DELETE CASCADE 会误删
-- 指向套件的同类行，所以目标关系不建外键，由 service 在删除/同步时处理。
