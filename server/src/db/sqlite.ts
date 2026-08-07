import { Database } from "jsr:@db/sqlite@0.13.0";
import { schemaSql } from "./schema.ts";

export function openDatabase(path = "kanban.db") {
  const db = new Database(path, { memory: path === ":memory:" });
  db.exec(schemaSql);
  migrate(db);
  return db;
}

// Existing databases created before a column was added to schema.ts won't
// pick it up via `CREATE TABLE IF NOT EXISTS`, so migrate them explicitly.
function migrate(db: Database) {
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN branch TEXT NOT NULL DEFAULT ''`);
  } catch {
    // column already exists
  }

  normalizeBranches(db);
}

// branch is always derived from the task id (e.g. "task/12"), never
// user-supplied, so this is safe to run unconditionally on every open. It
// fixes rows left blank by the ALTER TABLE above and rows written under the
// old title-slug scheme (e.g. "task/4-todo").
function normalizeBranches(db: Database) {
  db.exec(`UPDATE tasks SET branch = 'task/' || id WHERE branch IS NULL OR branch != 'task/' || id`);
}