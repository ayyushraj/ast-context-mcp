# ast-context

Enterprise AST Context Indexer & MCP Server. Parses TypeScript, JavaScript, and Python with tree-sitter into a local SQLite index, then exposes deterministic symbol, call-graph, type, and git-blame queries over MCP (stdio) — no embeddings.

## Install

```bash
cd ast-context
npm install
npm run build
```

Requires **Node 22+** (uses built-in `node:sqlite`).

## CLI

```bash
# Index a workspace (writes <root>/.ast-context/index.db)
npx ast-context index /path/to/workspace

# Force full re-index
npx ast-context index /path/to/workspace --full

# Status
npx ast-context status /path/to/workspace

# Ad-hoc queries
npx ast-context query symbol createUser -r /path/to/workspace
npx ast-context query def User -r /path/to/workspace
npx ast-context query callers createUser -r /path/to/workspace
npx ast-context query callees main -r /path/to/workspace

# MCP server (stdio)
npx ast-context serve --root /path/to/workspace
```

## Cursor MCP config

```json
{
  "mcpServers": {
    "ast-context": {
      "command": "node",
      "args": [
        "/absolute/path/to/ast-context/dist/cli.js",
        "serve",
        "--root",
        "/path/to/workspace"
      ]
    }
  }
}
```

Or during development:

```json
{
  "mcpServers": {
    "ast-context": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/ast-context/src/cli.ts", "serve", "--root", "/path/to/workspace"]
    }
  }
}
```

## MCP tools

| Tool | Purpose |
|------|---------|
| `index_status` | Index health and counts |
| `find_symbol` | Lookup by name / prefix / kind / path |
| `get_definition` | Primary definition + snippet |
| `find_references` | Call sites for a name |
| `get_callers` / `get_callees` | One-hop call graph |
| `get_type_info` | AST-extracted types / interfaces / annotations |
| `list_file_symbols` | File outline |
| `git_blame` | Blame for file + optional line range |

## Notes

- Call resolution is **name + same-file / unique-global heuristics**, not a full type checker.
- Types come from AST annotations (interfaces, type aliases, param/return annotations) — not `tsc` / Pyright inference.
- Incremental indexing skips unchanged files via SHA-256 content hashes.
- Respects `.gitignore` plus defaults (`node_modules`, `dist`, `.venv`, etc.).

## License

MIT
