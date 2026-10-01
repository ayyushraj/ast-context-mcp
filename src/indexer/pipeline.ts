/**
 * Full and incremental indexing.
 * Unchanged files are skipped by SHA-256 of their contents, so an extractor
 * change is invisible until the next --full run.
 */
import { readFileSync } from "node:fs";
import { IndexStore } from "../store/db.js";
import { hashBuffer } from "./hash.js";
import { initParser, parseSource } from "./parser.js";
import { walkWorkspace, type WalkedFile } from "./walk.js";
import { extractFromTree } from "./extract/index.js";

export interface IndexStats {
  root: string;
  scanned: number;
  indexed: number;
  skipped: number;
  deleted: number;
  failed: number;
  symbols: number;
  calls: number;
  imports: number;
  resolvedCalls: number;
  durationMs: number;
}

export async function runIndex(
  root: string,
  dbPath: string,
  opts: { full?: boolean } = {}
): Promise<IndexStats> {
  const started = Date.now();
  await initParser();

  const store = new IndexStore(dbPath);
  const files = walkWorkspace(root);
  const seen = new Set<string>();

  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let symbols = 0;
  let calls = 0;
  let imports = 0;

  for (const file of files) {
    seen.add(file.relativePath);
    const source = readFileSync(file.absolutePath);
    const hash = hashBuffer(source);

    // Content hash, not mtime: a touch without an edit must not rewrite the row.
    if (!opts.full) {
      const existing = store.getFileByPath(file.relativePath);
      if (existing && existing.hash === hash) {
        skipped++;
        continue;
      }
    }

    const text = source.toString("utf8");
    let tree: Awaited<ReturnType<typeof parseSource>>["tree"] | null = null;
    let parser: Awaited<ReturnType<typeof parseSource>>["parser"] | null =
      null;

    try {
      const parsed = await parseSource(file.language, text);
      tree = parsed.tree;
      parser = parsed.parser;
      const extracted = extractFromTree(file.language, tree, text);

      store.transaction(() => {
        const fileId = store.replaceFile({
          path: file.relativePath,
          language: file.language,
          hash,
          mtime: file.mtimeMs,
          size: file.size,
        });

        const symbolIds = new Map<string, number>();
        for (const s of extracted.symbols) {
          const id = store.insertSymbol({
            file_id: fileId,
            name: s.name,
            kind: s.kind,
            container: s.container,
            start_line: s.range.startLine,
            start_col: s.range.startCol,
            end_line: s.range.endLine,
            end_col: s.range.endCol,
            signature: s.signature,
            type_text: s.typeText,
          });
          // Prefer function/method/class for caller lookup
          if (
            s.kind === "function" ||
            s.kind === "method" ||
            s.kind === "class"
          ) {
            symbolIds.set(s.name, id);
          } else if (!symbolIds.has(s.name)) {
            symbolIds.set(s.name, id);
          }
          symbols++;
        }

        for (const c of extracted.calls) {
          const callerId = c.callerName
            ? symbolIds.get(c.callerName) ?? null
            : null;
          store.insertCall({
            caller_symbol_id: callerId,
            callee_name: c.calleeName,
            file_id: fileId,
            start_line: c.range.startLine,
            start_col: c.range.startCol,
            end_line: c.range.endLine,
            end_col: c.range.endCol,
          });
          calls++;
        }

        for (const im of extracted.imports) {
          store.insertImport({
            file_id: fileId,
            source_module: im.sourceModule,
            local_name: im.localName,
            imported_name: im.importedName,
          });
          imports++;
        }
      });

      indexed++;
    } catch (err) {
      failed++;
      console.error(
        `Failed to index ${file.relativePath}:`,
        err instanceof Error ? err.message : err
      );
    } finally {
      tree?.delete();
      parser?.delete();
    }
  }

  // Remove deleted files
  let deleted = 0;
  for (const row of store.listFiles()) {
    if (!seen.has(row.path)) {
      store.deleteFileByPath(row.path);
      deleted++;
    }
  }

  const resolvedCalls = store.resolveCalls();
  store.markIndexed(root);

  const stats: IndexStats = {
    root,
    scanned: files.length,
    indexed,
    skipped,
    deleted,
    failed,
    symbols,
    calls,
    imports,
    resolvedCalls,
    durationMs: Date.now() - started,
  };

  store.close();
  return stats;
}

export type { WalkedFile };
