/**
 * Indexing speed benchmark for portfolio / debriefs.
 *
 * Default: clone (shallow) express into .bench-cache and time a full index.
 * Override: BENCH_REPO_URL / BENCH_REPO_DIR, or --repo / --dir flags.
 *
 * Usage:
 *   npx tsx scripts/bench.ts
 *   npx tsx scripts/bench.ts --repo https://github.com/tiangolo/fastapi.git --name fastapi
 *   npm run bench
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { runIndex } from "../src/indexer/pipeline.js";
import { resolveConfig } from "../src/config.js";
import { IndexStore } from "../src/store/db.js";
import { indexStatus } from "../src/store/queries.js";
import { printTokenSavings } from "../src/metrics/report.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(rootDir, ".bench-cache");

interface BenchTarget {
  name: string;
  url: string;
  dirName: string;
}

const DEFAULTS: Record<string, BenchTarget> = {
  express: {
    name: "express",
    url: "https://github.com/expressjs/express.git",
    dirName: "express",
  },
  fastapi: {
    name: "fastapi",
    url: "https://github.com/tiangolo/fastapi.git",
    dirName: "fastapi",
  },
};

function parseArgs(argv: string[]) {
  let repo = process.env.BENCH_REPO_URL;
  let name = process.env.BENCH_NAME ?? "express";
  let dir = process.env.BENCH_REPO_DIR;
  let keep = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo" && argv[i + 1]) {
      repo = argv[++i];
    } else if (a === "--name" && argv[i + 1]) {
      name = argv[++i]!;
    } else if (a === "--dir" && argv[i + 1]) {
      dir = argv[++i];
    } else if (a === "--keep") {
      keep = true;
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: bench.ts [--name express|fastapi] [--repo URL] [--dir PATH] [--keep]`);
      process.exit(0);
    }
  }

  const preset = DEFAULTS[name] ?? DEFAULTS.express!;
  return {
    name: name || preset.name,
    url: repo ?? preset.url,
    dir: dir ? resolve(dir) : join(cacheDir, preset.dirName),
    keep,
  };
}

function ensureClone(url: string, dest: string): void {
  if (existsSync(join(dest, ".git"))) {
    console.log(`Using cached clone: ${dest}`);
    return;
  }
  mkdirSync(cacheDir, { recursive: true });
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  console.log(`Cloning (shallow) ${url} → ${dest}`);
  const r = spawnSync(
    "git",
    ["clone", "--depth", "1", "--single-branch", url, dest],
    { encoding: "utf8", stdio: "inherit" }
  );
  if (r.status !== 0) {
    throw new Error(`git clone failed for ${url}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  ensureClone(opts.url, opts.dir);

  const config = resolveConfig(opts.dir);
  // Fresh full index for timing
  if (existsSync(config.indexDir)) {
    rmSync(config.indexDir, { recursive: true, force: true });
  }

  console.log(`\n=== Indexing ${opts.name} ===`);
  console.log(`Root: ${config.root}`);
  const t0 = performance.now();
  const stats = await runIndex(config.root, config.dbPath, { full: true });
  const wallMs = Math.round(performance.now() - t0);

  const store = new IndexStore(config.dbPath);
  const status = indexStatus(store.db);

  console.log(`\nBenchmark results (${opts.name})`);
  console.log(`  Wall clock:     ${wallMs} ms`);
  console.log(`  Pipeline:       ${stats.durationMs} ms`);
  console.log(`  Files scanned:  ${stats.scanned}`);
  console.log(`  Files indexed:  ${stats.indexed}`);
  console.log(`  Symbols:        ${status.symbols}`);
  console.log(`  Calls:          ${status.calls}`);
  console.log(`  Imports:        ${status.imports}`);
  console.log(`  Languages:      ${status.languages.map((l) => `${l.language}:${l.count}`).join(", ")}`);

  console.log(`\n--- Token savings (largest indexed file) ---`);
  printTokenSavings(store.db, config.root);
  store.close();

  // One-liner for README / slides
  console.log(
    `\nQuote: Indexed ${opts.name} (${stats.scanned} files, ${status.symbols} symbols) in ${wallMs} ms.`
  );

  if (!opts.keep) {
    // keep clone cache; only note index lives under repo
    console.log(`\nClone cache kept at ${opts.dir} (pass nothing special). Index at ${config.dbPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
