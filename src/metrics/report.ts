import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  getDefinition,
  listFileSymbols,
  type SymbolHit,
} from "../store/queries.js";
import {
  compareFileVsTools,
  renderTokenSavingsHuman,
  type TokenSavingsReport,
} from "./tokens.js";

function withSnippet(root: string, hit: SymbolHit, contextLines = 2) {
  const abs = resolve(root, hit.path);
  let snippet: string | null = null;
  if (existsSync(abs)) {
    try {
      const lines = readFileSync(abs, "utf8").split(/\r?\n/);
      const start = Math.max(0, hit.start_line - 1 - contextLines);
      const end = Math.min(lines.length, hit.end_line + contextLines);
      snippet = lines.slice(start, end).join("\n");
      if (snippet.length > 2000) snippet = snippet.slice(0, 2000) + "\n…";
    } catch {
      snippet = null;
    }
  }
  return { ...hit, snippet };
}

/**
 * Pick a representative file from the index (prefer largest source that isn't
 * pathologically symbol-dense test dumps when possible — prefer mid/large size).
 */
export function pickBenchmarkFile(
  db: DatabaseSync
): { path: string; size: number } | null {
  // Prefer application-ish files: largest under 2000 lines-ish by size, else largest
  const candidates = db
    .prepare(
      `
      SELECT f.path, f.size, COUNT(s.id) AS symbol_count
      FROM files f
      LEFT JOIN symbols s ON s.file_id = f.id
      GROUP BY f.id
      ORDER BY f.size DESC
      LIMIT 20
    `
    )
    .all() as Array<{ path: string; size: number; symbol_count: number }>;

  if (!candidates.length) return null;

  const preferred = candidates.find(
    (c) =>
      c.size >= 8_000 &&
      c.size <= 80_000 &&
      !/test_|_test\.|spec\./i.test(c.path)
  );
  return preferred ?? candidates[0] ?? null;
}

/** Compact outline an agent would actually keep in context (no params). */
function compactOutline(db: DatabaseSync, filePath: string) {
  return listFileSymbols(db, filePath)
    .filter((s) =>
      ["function", "method", "class", "interface", "type", "variable"].includes(
        s.kind
      )
    )
    .map((s) => ({
      name: s.name,
      kind: s.kind,
      line: s.start_line,
      container: s.container,
      sig: s.signature?.slice(0, 80) ?? null,
    }));
}

export function computeTokenSavings(
  db: DatabaseSync,
  root: string,
  filePath?: string
): TokenSavingsReport | null {
  const chosen =
    filePath ??
    pickBenchmarkFile(db)?.path ??
    null;
  if (!chosen) return null;

  const abs = resolve(root, chosen);
  if (!existsSync(abs)) return null;

  const sourceText = readFileSync(abs, "utf8");
  // Compact JSON (no pretty-print) — matches how tool results should be budgeted
  const listJson = JSON.stringify(compactOutline(db, chosen));

  const prefer = listFileSymbols(db, chosen).find((s) =>
    ["function", "method", "class", "interface", "type"].includes(s.kind)
  );
  const defHit = prefer
    ? getDefinition(db, prefer.name, prefer.kind) ?? prefer
    : null;
  const defPayload = defHit
    ? {
        name: defHit.name,
        kind: defHit.kind,
        path: defHit.path,
        start_line: defHit.start_line,
        end_line: defHit.end_line,
        signature: defHit.signature,
        snippet: withSnippet(root, defHit).snippet,
      }
    : { found: false };
  const defJson = JSON.stringify(defPayload);

  return compareFileVsTools({
    filePath: chosen,
    sourceText,
    listFileSymbolsJson: listJson,
    getDefinitionJson: defJson,
  });
}

export function printTokenSavings(
  db: DatabaseSync,
  root: string,
  filePath?: string
): TokenSavingsReport | null {
  const report = computeTokenSavings(db, root, filePath);
  if (!report) {
    console.error("No indexed file available for token savings benchmark.");
    return null;
  }
  console.log(renderTokenSavingsHuman(report));
  return report;
}
