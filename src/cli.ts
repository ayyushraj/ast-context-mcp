#!/usr/bin/env node
import { Command } from "commander";
import { resolveConfig } from "./config.js";
import { runIndex } from "./indexer/pipeline.js";
import { startMcpServer } from "./mcp/server.js";
import { IndexStore } from "./store/db.js";
import {
  findSymbols,
  getCallees,
  getCallers,
  getDefinition,
  indexStatus,
} from "./store/queries.js";
import { computeTokenSavings, printTokenSavings } from "./metrics/report.js";
import { existsSync } from "node:fs";

const program = new Command();

program
  .name("ast-context")
  .description(
    "Enterprise AST Context Indexer & MCP Server — deterministic symbol, call-graph, type, and git-blame queries"
  )
  .version("0.1.0");

program
  .command("index")
  .description("Index a workspace into .ast-context/index.db")
  .argument("[root]", "Workspace root", process.cwd())
  .option("-f, --full", "Force full re-index (ignore content hashes)", false)
  .action(async (root: string, opts: { full?: boolean }) => {
    const config = resolveConfig(root);
    console.log(`Indexing ${config.root} → ${config.dbPath}`);
    const stats = await runIndex(config.root, config.dbPath, {
      full: opts.full,
    });
    console.log(JSON.stringify(stats, null, 2));
  });

program
  .command("serve")
  .description("Start MCP server over stdio")
  .option("-r, --root <path>", "Workspace root", process.cwd())
  .option("--reindex", "Re-index before serving", false)
  .action(async (opts: { root: string; reindex?: boolean }) => {
    const config = resolveConfig(opts.root);
    if (opts.reindex || !existsSync(config.dbPath)) {
      process.stderr.write(`Indexing ${config.root}…\n`);
      await runIndex(config.root, config.dbPath);
    }
    await startMcpServer(opts.root);
  });

program
  .command("status")
  .description("Show index status (+ token savings vs full-file context)")
  .argument("[root]", "Workspace root", process.cwd())
  .option("--json", "JSON only (no human token savings block)", false)
  .action((root: string, opts: { json?: boolean }) => {
    const config = resolveConfig(root);
    if (!existsSync(config.dbPath)) {
      console.error(`No index at ${config.dbPath}. Run: ast-context index`);
      process.exit(1);
    }
    const store = new IndexStore(config.dbPath);
    const status = indexStatus(store.db);
    const savings = computeTokenSavings(store.db, config.root);
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            ...status,
            token_savings: savings
              ? {
                  file: savings.filePath,
                  file_lines: savings.fileLines,
                  naive_full_file_tokens: savings.naiveFullFileTokens,
                  structured_tool_tokens: savings.structuredToolTokens,
                  tokens_saved: savings.tokensSaved,
                  savings_percent: savings.savingsPercent,
                }
              : null,
          },
          null,
          2
        )
      );
    } else {
      console.log(JSON.stringify(status, null, 2));
      if (savings) {
        console.log("");
        printTokenSavings(store.db, config.root, savings.filePath);
      }
    }
    store.close();
  });

program
  .command("tokens")
  .description(
    "Compare tokens: full source file vs list_file_symbols + get_definition"
  )
  .argument("[root]", "Workspace root", process.cwd())
  .option("-f, --file <path>", "Relative file path (default: largest indexed)")
  .option("--json", "Emit JSON report", false)
  .action((root: string, opts: { file?: string; json?: boolean }) => {
    const config = resolveConfig(root);
    if (!existsSync(config.dbPath)) {
      console.error(`No index at ${config.dbPath}. Run: ast-context index`);
      process.exit(1);
    }
    const store = new IndexStore(config.dbPath);
    const report = computeTokenSavings(store.db, config.root, opts.file);
    if (!report) {
      console.error("No file available for token comparison.");
      store.close();
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTokenSavings(store.db, config.root, opts.file);
    }
    store.close();
  });

const query = program
  .command("query")
  .description("Query the local index (debug)");

query
  .command("symbol")
  .description("Find symbols by name or prefix")
  .argument("<name>", "Exact name or prefix (use --prefix)")
  .option("-r, --root <path>", "Workspace root", process.cwd())
  .option("--prefix", "Treat argument as prefix", false)
  .option("--kind <kind>", "Filter by kind")
  .action((name: string, opts: { root: string; prefix?: boolean; kind?: string }) => {
    const config = resolveConfig(opts.root);
    if (!existsSync(config.dbPath)) {
      console.error(`No index at ${config.dbPath}`);
      process.exit(1);
    }
    const store = new IndexStore(config.dbPath);
    const hits = findSymbols(store.db, {
      name: opts.prefix ? undefined : name,
      prefix: opts.prefix ? name : undefined,
      kind: opts.kind as never,
      limit: 50,
    });
    console.log(JSON.stringify(hits, null, 2));
    store.close();
  });

query
  .command("def")
  .description("Get primary definition")
  .argument("<name>", "Symbol name")
  .option("-r, --root <path>", "Workspace root", process.cwd())
  .action((name: string, opts: { root: string }) => {
    const config = resolveConfig(opts.root);
    const store = new IndexStore(config.dbPath);
    console.log(JSON.stringify(getDefinition(store.db, name), null, 2));
    store.close();
  });

query
  .command("callers")
  .argument("<name>", "Callee name")
  .option("-r, --root <path>", "Workspace root", process.cwd())
  .action((name: string, opts: { root: string }) => {
    const config = resolveConfig(opts.root);
    const store = new IndexStore(config.dbPath);
    console.log(JSON.stringify(getCallers(store.db, name), null, 2));
    store.close();
  });

query
  .command("callees")
  .argument("<name>", "Caller name")
  .option("-r, --root <path>", "Workspace root", process.cwd())
  .action((name: string, opts: { root: string }) => {
    const config = resolveConfig(opts.root);
    const store = new IndexStore(config.dbPath);
    console.log(JSON.stringify(getCallees(store.db, name), null, 2));
    store.close();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
