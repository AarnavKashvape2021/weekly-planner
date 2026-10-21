CREATE TABLE IF NOT EXISTS planner_store (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
