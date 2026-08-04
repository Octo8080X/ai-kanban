import { Database } from "jsr:@db/sqlite@0.13.0";
import { schemaSql } from "./schema.ts";

export function openDatabase(path = "kanban.db") {
  const db = new Database(path, { memory: path === ":memory:" });
  db.exec(schemaSql);
  return db;
}