CREATE TABLE IF NOT EXISTS workspace_file_deletions (
  user_id TEXT NOT NULL,
  path TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY(user_id,path)
);
