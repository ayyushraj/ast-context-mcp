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

# Status (+ token savings block)
npx ast-context status /path/to/workspace

# Token savings: full file vs list_file_symbols + get_definition
npx ast-context tokens /path/to/workspace
npx ast-context tokens /path/to/workspace --file path/to/file.ts --json

# Ad-hoc queries
npx ast-context query symbol createUser -r /path/to/workspace
npx ast-context query def User -r /path/to/workspace
npx ast-context query callers createUser -r /path/to/workspace
npx ast-context query callees main -r /path/to/workspace

# MCP server (stdio)
npx ast-context serve --root /path/to/workspace
```

## Token savings (why structured beats dumping files)

Agents often paste whole files into context. `ast-context` returns **compact JSON** (outline + definition) instead.

Heuristic used for demos: **~chars / 4 ≈ tokens** (not a model tokenizer — good enough for debriefs).

```bash
node dist/cli.js index /path/to/workspace
node dist/cli.js tokens /path/to/workspace
node dist/cli.js tokens /path/to/workspace --file path/to/big_file.py
```

Example (236-line Python file from a real project):

```text
Naive full file:           ~1,336 tokens
get_definition alone:      ~71 tokens  (−1,265, 94.7%)
list_file_symbols+def:     ~814 tokens  (−522, 39.1%)
```

On ~1000-line files, `get_definition` routinely stays under ~100 tokens while the raw file is thousands.

## Indexing benchmark (open-source repos)

Times a full index of a shallow-cloned popular repo (default: **express**; also **fastapi**):

```bash
npm run bench              # express
npm run bench:fastapi      # fastapi (Python-heavy)
npx tsx scripts/bench.ts --name express
```

Measured on this machine (shallow clone, full index):

```text
Indexed express (141 files, 1970 symbols) in 355 ms.
```

Also prints a token-savings sample from a large indexed file. Clones land in `.bench-cache/` (gitignored).
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

- Storage uses Node’s built-in `node:sqlite` (Node 22+); index lives at `<root>/.ast-context/index.db`.
- Call resolution is **name + same-file / unique-global heuristics**, not a full type checker.
- Types come from AST annotations (interfaces, type aliases, param/return annotations) — not `tsc` / Pyright inference.
- Incremental indexing skips unchanged files via SHA-256 content hashes.
- Respects `.gitignore` plus defaults (`node_modules`, `dist`, `.venv`, etc.).

## Smoke test

```bash
npm run smoke
```

## License

MIT
