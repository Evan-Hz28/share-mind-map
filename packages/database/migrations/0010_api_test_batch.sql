-- 一次选中多个套件执行时，给这批 run 打同一个 batch_id，报告页按它聚合。
-- 不建批次表：批次没有独立生命周期，状态和统计都由子 run 派生，加表只会多一份要同步的数据。
ALTER TABLE api_test_runs ADD COLUMN IF NOT EXISTS batch_id uuid;

CREATE INDEX IF NOT EXISTS api_test_runs_batch_idx
  ON api_test_runs (batch_id, created_at DESC, id DESC);
