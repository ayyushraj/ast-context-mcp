import type { DatabaseSync } from "node:sqlite";
import { openDatabase, setMeta, type SymbolKind } from "./schema.js";

export interface UpsertFileInput {
  path: string;
  language: string;
  hash: string;
  mtime: number;
  size: number;
}

export interface InsertSymbolInput {
  file_id: number;
  name: string;
  kind: SymbolKind;
  container: string | null;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  signature: string | null;
  type_text: string | null;
}

export interface InsertCallInput {
  caller_symbol_id: number | null;
  callee_name: string;
  file_id: number;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
}

export interface InsertImportInput {
  file_id: number;
  source_module: string;
  local_name: string;
  imported_name: string | null;
}

export class IndexStore {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = openDatabase(dbPath);
  }

  close(): void {
    this.db.close();
  }

  getFileByPath(path: string) {
    return this.db
      .prepare("SELECT * FROM files WHERE path = ?")
      .get(path) as
      | {
          id: number;
          path: string;
          language: string;
          hash: string;
          mtime: number;
          size: number;
        }
      | undefined;
  }

  listFiles() {
    return this.db
      .prepare("SELECT * FROM files ORDER BY path")
      .all() as Array<{
      id: number;
      path: string;
      language: string;
      hash: string;
      mtime: number;
      size: number;
    }>;
  }

  /** Replace file row and cascade-delete old symbols/calls/imports. */
  replaceFile(input: UpsertFileInput): number {
    const existing = this.getFileByPath(input.path);
    if (existing) {
      this.db.prepare("DELETE FROM files WHERE id = ?").run(existing.id);
    }
    const result = this.db
      .prepare(
        `INSERT INTO files (path, language, hash, mtime, size)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.path,
        input.language,
        input.hash,
        input.mtime,
        input.size
      );
    return Number(result.lastInsertRowid);
  }

  deleteFileByPath(path: string): void {
    this.db.prepare("DELETE FROM files WHERE path = ?").run(path);
  }

  insertSymbol(input: InsertSymbolInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO symbols
         (file_id, name, kind, container, start_line, start_col, end_line, end_col, signature, type_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.file_id,
        input.name,
        input.kind,
        input.container,
        input.start_line,
        input.start_col,
        input.end_line,
        input.end_col,
        input.signature,
        input.type_text
      );
    return Number(result.lastInsertRowid);
  }

  insertCall(input: InsertCallInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO calls
         (caller_symbol_id, callee_name, callee_symbol_id, file_id, start_line, start_col, end_line, end_col)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`
      )
      .run(
        input.caller_symbol_id,
        input.callee_name,
        input.file_id,
        input.start_line,
        input.start_col,
        input.end_line,
        input.end_col
      );
    return Number(result.lastInsertRowid);
  }

  insertImport(input: InsertImportInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO imports (file_id, source_module, local_name, imported_name)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        input.file_id,
        input.source_module,
        input.local_name,
        input.imported_name
      );
    return Number(result.lastInsertRowid);
  }

  /** Resolve callee_symbol_id using name matches (prefer same file, then unique global). */
  resolveCalls(): number {
    const calls = this.db
      .prepare(
        `SELECT id, file_id, callee_name FROM calls WHERE callee_symbol_id IS NULL`
      )
      .all() as Array<{ id: number; file_id: number; callee_name: string }>;

    const update = this.db.prepare(
      `UPDATE calls SET callee_symbol_id = ? WHERE id = ?`
    );
    const sameFile = this.db.prepare(
      `SELECT id FROM symbols WHERE file_id = ? AND name = ?
       AND kind IN ('function','method','class')
       ORDER BY start_line LIMIT 1`
    );
    const globalUnique = this.db.prepare(
      `SELECT id FROM symbols WHERE name = ?
       AND kind IN ('function','method','class')
       GROUP BY name HAVING COUNT(*) = 1`
    );

    let resolved = 0;
    this.db.exec("BEGIN");
    try {
      for (const c of calls) {
        const local = sameFile.get(c.file_id, c.callee_name) as
          | { id: number }
          | undefined;
        if (local) {
          update.run(local.id, c.id);
          resolved++;
          continue;
        }
        const g = globalUnique.get(c.callee_name) as { id: number } | undefined;
        if (g) {
          update.run(g.id, c.id);
          resolved++;
        }
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return resolved;
  }

  markIndexed(root: string): void {
    setMeta(this.db, "root", root);
    setMeta(this.db, "indexed_at", new Date().toISOString());
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
