#!/usr/bin/env node
/**
 * Quick smoke test against fixtures/
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");
const fixtures = join(root, "fixtures");

function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd: root,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

run(["index", fixtures, "--full"]);
// status without --json appends a human token-savings block after the JSON object
const status = JSON.parse(run(["status", fixtures, "--json"]));
if (status.files < 2 || status.symbols < 10) {
  console.error("Unexpected status", status);
  process.exit(1);
}

const createUser = JSON.parse(
  run(["query", "symbol", "createUser", "-r", fixtures])
);
if (!createUser.some((s) => s.name === "createUser")) {
  console.error("createUser missing", createUser);
  process.exit(1);
}

const callers = JSON.parse(
  run(["query", "callers", "createUser", "-r", fixtures])
);
if (!callers.some((c) => c.caller_name === "main")) {
  console.error("expected main -> createUser", callers);
  process.exit(1);
}

const order = JSON.parse(run(["query", "def", "Order", "-r", fixtures]));
if (!order || order.kind !== "class") {
  console.error("Order class missing", order);
  process.exit(1);
}

console.log("smoke OK", {
  files: status.files,
  symbols: status.symbols,
  calls: status.calls,
  imports: status.imports,
});
