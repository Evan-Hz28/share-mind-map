ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_id uuid;

ALTER TABLE folders
  ADD CONSTRAINT folders_parent_fk
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE;

-- 同级重名才冲突。NULL 在唯一索引里互不相等,顶层必须用 COALESCE 折成一个哨兵值。
DROP INDEX IF EXISTS folders_workspace_name_active_uq;
CREATE UNIQUE INDEX IF NOT EXISTS folders_workspace_parent_name_active_uq
  ON folders (
    workspace_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name_normalized
  )
  WHERE trashed_at IS NULL;

CREATE INDEX IF NOT EXISTS folders_workspace_parent_sort_idx
  ON folders (workspace_id, parent_id, sort_key)
  WHERE trashed_at IS NULL;
