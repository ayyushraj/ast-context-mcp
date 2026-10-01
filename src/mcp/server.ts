/**
 * MCP over stdio. stdout is the protocol stream, so progress logs go to stderr.
 * Cursor starts this process; a manual run looks idle because nothing is connected.
 */
import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveConfig } from "../config.js";
import { runIndex } from "../indexer/pipeline.js";
import { IndexStore } from "../store/db.js";
import { registerTools } from "./tools.js";

export async function startMcpServer(rootArg?: string): Promise<void> {
  const config = resolveConfig(rootArg);

  if (!existsSync(config.dbPath)) {
    process.stderr.write(`No index found; indexing ${config.root}…\n`);
    await runIndex(config.root, config.dbPath);
  }

  const store = new IndexStore(config.dbPath);
  const server = new McpServer({
    name: "ast-context",
    version: "0.1.0",
  });

  registerTools(server, store, config.root);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
