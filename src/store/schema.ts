import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_VERSION } from "../config.js";

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "module"
  | "parameter";

export interface FileRow {
  id: number;
  path: string;
  language: string;
  hash: string;
  mtime: number;
  size: number;
}

export type Db = DatabaseSync;

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL,
  hash TEXT NOT NULL,
  mtime REAL NOT NULL,
  size INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  container TEXT,
  start_line INTEGER NOT NULL,
  start_col INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_col INTEGER NOT NULL,
  signature TEXT,
  type_text TEXT
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  callee_name TEXT NOT NULL,
  callee_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  start_line INTEGER NOT NULL,
  start_col INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_col INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  source_module TEXT NOT NULL,
  local_name TEXT NOT NULL,
  imported_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
CREATE INDEX IF NOT EXISTS idx_calls_callee_name ON calls(callee_name);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_symbol_id);
CREATE INDEX IF NOT EXISTS idx_calls_file ON calls(file_id);
CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_id);
CREATE INDEX IF NOT EXISTS idx_imports_local ON imports(local_name);
`;

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(MIGRATION_SQL);

  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  if (!row) {
    db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?)"
    ).run("schema_version", String(SCHEMA_VERSION));
  }

  return db;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
