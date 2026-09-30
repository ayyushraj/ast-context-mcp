import { join, resolve } from "node:path";

export const INDEX_DIR = ".ast-context";
export const DB_NAME = "index.db";
export const SCHEMA_VERSION = 1;

export const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ast-context",
  ".next",
  ".nuxt",
  "target",
  "*.min.js",
  "*.min.css",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

export const INDEXABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".pyi",
]);

export interface Config {
  root: string;
  indexDir: string;
  dbPath: string;
}

export function resolveConfig(rootArg?: string): Config {
  const root = resolve(rootArg ?? process.cwd());
  const indexDir = join(root, INDEX_DIR);
  return {
    root,
    indexDir,
    dbPath: join(indexDir, DB_NAME),
  };
}
