import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IndexStore } from "../store/db.js";
import {
  findReferences,
  findSymbols,
  getCallees,
  getCallers,
  getDefinition,
  getTypeInfo,
  indexStatus,
  listFileSymbols,
  type SymbolHit,
} from "../store/queries.js";
import { gitBlame } from "../blame/git.js";
import type { SymbolKind } from "../store/schema.js";

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function withSnippet(root: string, hit: SymbolHit, contextLines = 0) {
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

const kindSchema = z.enum([
  "function",
  "method",
  "class",
  "interface",
  "type",
  "variable",
  "module",
  "parameter",
]);

export function registerTools(
  server: McpServer,
  store: IndexStore,
  root: string
): void {
  server.registerTool(
    "index_status",
    {
      description:
        "Return index health: file/symbol/call counts, languages, last indexed time.",
    },
    async () => json(indexStatus(store.db))
  );

  server.registerTool(
    "find_symbol",
    {
      description:
        "Find symbols by exact name, prefix, optional kind, and/or file path.",
      inputSchema: {
        name: z.string().optional().describe("Exact symbol name"),
        prefix: z.string().optional().describe("Name prefix match"),
        kind: kindSchema.optional(),
        path: z.string().optional().describe("Relative file path"),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) => {
      const hits = findSymbols(store.db, {
        name: args.name,
        prefix: args.prefix,
        kind: args.kind as SymbolKind | undefined,
        path: args.path,
        limit: args.limit,
      });
      return json(hits.map((h) => withSnippet(root, h)));
    }
  );

  server.registerTool(
    "get_definition",
    {
      description: "Get the primary definition location for a symbol name.",
      inputSchema: {
        name: z.string().describe("Symbol name"),
        kind: kindSchema.optional(),
      },
    },
    async (args) => {
      const hit = getDefinition(
        store.db,
        args.name,
        args.kind as SymbolKind | undefined
      );
      if (!hit) return json({ found: false, name: args.name });
      return json({ found: true, definition: withSnippet(root, hit, 2) });
    }
  );

  server.registerTool(
    "find_references",
    {
      description:
        "Find call sites / references to a symbol name (approximate call-graph edges).",
      inputSchema: {
        name: z.string(),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    async (args) =>
      json(findReferences(store.db, args.name, args.limit ?? 100))
  );

  server.registerTool(
    "get_callers",
    {
      description: "One-hop callers of a symbol (who calls this name).",
      inputSchema: {
        name: z.string(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) => json(getCallers(store.db, args.name, args.limit ?? 50))
  );

  server.registerTool(
    "get_callees",
    {
      description:
        "One-hop callees from a function/method symbol (what it calls).",
      inputSchema: {
        name: z.string().describe("Caller function/method name"),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) => json(getCallees(store.db, args.name, args.limit ?? 50))
  );

  server.registerTool(
    "get_type_info",
    {
      description:
        "AST-extracted type/interface/annotation info by symbol name or file+line.",
      inputSchema: {
        name: z.string().optional(),
        path: z.string().optional(),
        line: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      const hits = getTypeInfo(store.db, {
        name: args.name,
        path: args.path,
        line: args.line,
      });
      return json(hits.map((h) => withSnippet(root, h)));
    }
  );

  server.registerTool(
    "list_file_symbols",
    {
      description: "List all indexed symbols in a single relative file path.",
      inputSchema: {
        path: z.string().describe("Relative path from workspace root"),
      },
    },
    async (args) => json(listFileSymbols(store.db, args.path))
  );

  server.registerTool(
    "git_blame",
    {
      description: "Git blame for a file with optional 1-based line range.",
      inputSchema: {
        path: z.string().describe("Relative file path"),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      try {
        const result = await gitBlame(root, args.path, {
          startLine: args.startLine,
          endLine: args.endLine,
        });
        return json(result);
      } catch (err) {
        return json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );
}
