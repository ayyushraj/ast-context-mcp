import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { SymbolKind } from "./schema.js";
import { getMeta } from "./schema.js";

export interface SymbolHit {
  id: number;
  name: string;
  kind: SymbolKind;
  container: string | null;
  path: string;
  language: string;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  signature: string | null;
  type_text: string | null;
}

export interface CallSite {
  id: number;
  callee_name: string;
  path: string;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  caller_name: string | null;
  caller_id: number | null;
  callee_symbol_id: number | null;
}

function symbolSelect(where: string): string {
  return `
    SELECT s.id, s.name, s.kind, s.container, f.path, f.language,
           s.start_line, s.start_col, s.end_line, s.end_col,
           s.signature, s.type_text
    FROM symbols s
    JOIN files f ON f.id = s.file_id
    WHERE ${where}
  `;
}

function rows<T>(result: unknown): T[] {
  return result as T[];
}

export function findSymbols(
  db: DatabaseSync,
  opts: {
    name?: string;
    prefix?: string;
    kind?: SymbolKind;
    path?: string;
    limit?: number;
  }
): SymbolHit[] {
  const clauses: string[] = ["1=1"];
  const params: SQLInputValue[] = [];

  if (opts.name) {
    clauses.push("s.name = ?");
    params.push(opts.name);
  } else if (opts.prefix) {
    clauses.push("s.name LIKE ?");
    params.push(`${opts.prefix}%`);
  }
  if (opts.kind) {
    clauses.push("s.kind = ?");
    params.push(opts.kind);
  }
  if (opts.path) {
    clauses.push("f.path = ?");
    params.push(opts.path);
  }

  const limit = opts.limit ?? 50;
  const sql =
    symbolSelect(clauses.join(" AND ")) +
    ` ORDER BY s.name, f.path LIMIT ?`;
  params.push(limit);

  return rows<SymbolHit>(db.prepare(sql).all(...params));
}

export function getDefinition(
  db: DatabaseSync,
  name: string,
  kind?: SymbolKind
): SymbolHit | null {
  const hits = findSymbols(db, { name, kind, limit: 20 });
  if (hits.length === 0) return null;
  const priority: Record<string, number> = {
    class: 0,
    interface: 1,
    type: 2,
    function: 3,
    method: 4,
    module: 5,
    variable: 6,
    parameter: 7,
  };
  hits.sort(
    (a, b) => (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99)
  );
  return hits[0] ?? null;
}

export function findReferences(
  db: DatabaseSync,
  name: string,
  limit = 100
): CallSite[] {
  return rows<CallSite>(
    db
      .prepare(
        `
      SELECT c.id, c.callee_name, f.path,
             c.start_line, c.start_col, c.end_line, c.end_col,
             caller.name AS caller_name,
             c.caller_symbol_id AS caller_id,
             c.callee_symbol_id
      FROM calls c
      JOIN files f ON f.id = c.file_id
      LEFT JOIN symbols caller ON caller.id = c.caller_symbol_id
      WHERE c.callee_name = ?
      ORDER BY f.path, c.start_line
      LIMIT ?
    `
      )
      .all(name, limit)
  );
}

export function getCallers(
  db: DatabaseSync,
  name: string,
  limit = 50
): CallSite[] {
  return findReferences(db, name, limit);
}

export function getCallees(
  db: DatabaseSync,
  symbolName: string,
  limit = 50
): CallSite[] {
  return rows<CallSite>(
    db
      .prepare(
        `
      SELECT c.id, c.callee_name, f.path,
             c.start_line, c.start_col, c.end_line, c.end_col,
             s.name AS caller_name,
             c.caller_symbol_id AS caller_id,
             c.callee_symbol_id
      FROM calls c
      JOIN symbols s ON s.id = c.caller_symbol_id
      JOIN files f ON f.id = c.file_id
      WHERE s.name = ?
      ORDER BY f.path, c.start_line
      LIMIT ?
    `
      )
      .all(symbolName, limit)
  );
}

export function listFileSymbols(
  db: DatabaseSync,
  path: string
): SymbolHit[] {
  return findSymbols(db, { path, limit: 500 });
}

export function getTypeInfo(
  db: DatabaseSync,
  opts: { name?: string; path?: string; line?: number }
): SymbolHit[] {
  if (opts.name) {
    const typed = findSymbols(db, {
      name: opts.name,
      limit: 50,
    }).filter(
      (s) =>
        s.kind === "type" ||
        s.kind === "interface" ||
        s.kind === "class" ||
        !!s.type_text
    );
    if (typed.length) return typed;
    return findSymbols(db, { name: opts.name, limit: 20 });
  }

  if (opts.path && opts.line != null) {
    return rows<SymbolHit>(
      db
        .prepare(
          symbolSelect(
            `f.path = ? AND s.start_line <= ? AND s.end_line >= ?`
          ) + ` ORDER BY (s.end_line - s.start_line) ASC LIMIT 10`
        )
        .all(opts.path, opts.line, opts.line)
    );
  }

  return [];
}

export function indexStatus(db: DatabaseSync) {
  const files = (
    db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }
  ).c;
  const symbols = (
    db.prepare("SELECT COUNT(*) AS c FROM symbols").get() as { c: number }
  ).c;
  const calls = (
    db.prepare("SELECT COUNT(*) AS c FROM calls").get() as { c: number }
  ).c;
  const imports = (
    db.prepare("SELECT COUNT(*) AS c FROM imports").get() as { c: number }
  ).c;
  const byLang = rows<{ language: string; count: number }>(
    db
      .prepare(
        `SELECT language, COUNT(*) AS count FROM files GROUP BY language ORDER BY language`
      )
      .all()
  );

  return {
    root: getMeta(db, "root"),
    indexed_at: getMeta(db, "indexed_at"),
    schema_version: getMeta(db, "schema_version"),
    files,
    symbols,
    calls,
    imports,
    languages: byLang,
  };
}
