-- 已成功的导入任务不再占用目标文档名/内容哈希:
-- 文档本身仍由 documents 的唯一索引负责,导入任务只在真正进行中时去重。
-- 否则文档被删除后,历史 succeeded 任务会永久锁死同名重新导入。
DROP INDEX IF EXISTS import_jobs_workspace_target_name_active_uq;
CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_workspace_target_name_active_uq
  ON import_jobs (workspace_id, target_name_normalized)
  WHERE phase IN ('waiting', 'uploading', 'parsing', 'persisting');

DROP INDEX IF EXISTS import_jobs_workspace_sha256_active_uq;
CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_workspace_sha256_active_uq
  ON import_jobs (workspace_id, sha256)
  WHERE sha256 IS NOT NULL
    AND phase IN ('waiting', 'uploading', 'parsing', 'persisting');
