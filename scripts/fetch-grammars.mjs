/**
 * Build or download tree-sitter WASM grammars into grammars/.
 * Prefers `tree-sitter build --wasm` from installed grammar packages;
 * falls back to GitHub release assets.
 */
import { createWriteStream, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "grammars");
mkdirSync(outDir, { recursive: true });

function pkgRoot(name) {
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

function buildWasm(grammarPkg, outName) {
  const dir = pkgRoot(grammarPkg);
  if (!dir) return false;
  const cli = join(root, "node_modules", ".bin", "tree-sitter");
  if (!existsSync(cli)) {
    console.warn("[fetch-grammars] tree-sitter-cli not found");
    return false;
  }
  console.log(`[fetch-grammars] building ${outName} from ${grammarPkg}…`);
  const r = spawnSync(cli, ["build", "--wasm", dir], {
    cwd: outDir,
    encoding: "utf8",
    env: process.env,
  });
  if (r.status !== 0) {
    console.warn(r.stderr || r.stdout);
    return false;
  }
  // tree-sitter writes wasm into cwd with grammar name
  const produced = [
    join(outDir, outName),
    join(outDir, outName.replace("tree-sitter-", "")),
  ];
  // Also look for any newly created wasm in outDir matching package
  const base = outName;
  if (existsSync(join(outDir, base))) return true;
  // typescript package produces tree-sitter-typescript.wasm and tree-sitter-tsx.wasm depending on grammar path
  return existsSync(join(outDir, base));
}

async function download(url, dest) {
  console.log(`[fetch-grammars] download ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
  // Copy runtime wasm from web-tree-sitter
  try {
    const wts = pkgRoot("web-tree-sitter");
    if (wts) {
      for (const rel of ["tree-sitter.wasm", "debug/tree-sitter.wasm"]) {
        const src = join(wts, rel);
        if (existsSync(src)) {
          copyFileSync(src, join(outDir, "tree-sitter.wasm"));
          console.log(`[fetch-grammars] tree-sitter.wasm <- ${src}`);
          break;
        }
      }
    }
  } catch (e) {
    console.warn(e);
  }

  // Build from local grammar packages
  const builds = [
    { pkg: "tree-sitter-javascript", out: "tree-sitter-javascript.wasm" },
    { pkg: "tree-sitter-python", out: "tree-sitter-python.wasm" },
  ];

  for (const b of builds) {
    const dest = join(outDir, b.out);
    if (existsSync(dest)) {
      console.log(`[fetch-grammars] exists ${b.out}`);
      continue;
    }
    const ok = buildWasm(b.pkg, b.out);
    if (!ok) {
      console.warn(`[fetch-grammars] build failed for ${b.pkg}`);
    }
  }

  // TypeScript grammars live in subdirs
  const tsRoot = pkgRoot("tree-sitter-typescript");
  if (tsRoot) {
    for (const [sub, out] of [
      ["typescript", "tree-sitter-typescript.wasm"],
      ["tsx", "tree-sitter-tsx.wasm"],
    ]) {
      const dest = join(outDir, out);
      if (existsSync(dest)) {
        console.log(`[fetch-grammars] exists ${out}`);
        continue;
      }
      const grammarDir = join(tsRoot, sub);
      const cli = join(root, "node_modules", ".bin", "tree-sitter");
      console.log(`[fetch-grammars] building ${out} from ${grammarDir}…`);
      const r = spawnSync(cli, ["build", "--wasm", grammarDir], {
        cwd: outDir,
        encoding: "utf8",
        env: process.env,
      });
      if (r.status !== 0) {
        console.warn(r.stderr || r.stdout);
      } else if (!existsSync(dest)) {
        // cli may name file after folder
        const alt = join(outDir, `tree-sitter-${sub}.wasm`);
        if (existsSync(alt) && alt !== dest) {
          copyFileSync(alt, dest);
        }
      }
    }
  }

  // Fallback downloads from unofficial mirrors / gh if still missing
  const fallbacks = {
    "tree-sitter-javascript.wasm":
      "https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.23.1/tree-sitter-javascript.wasm",
    "tree-sitter-python.wasm":
      "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
    "tree-sitter-typescript.wasm":
      "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm",
    "tree-sitter-tsx.wasm":
      "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-tsx.wasm",
  };

  for (const [name, url] of Object.entries(fallbacks)) {
    const dest = join(outDir, name);
    if (existsSync(dest)) continue;
    try {
      await download(url, dest);
    } catch (e) {
      console.warn(`[fetch-grammars] fallback failed for ${name}:`, e.message);
    }
  }

  const needed = [
    "tree-sitter.wasm",
    "tree-sitter-javascript.wasm",
    "tree-sitter-typescript.wasm",
    "tree-sitter-tsx.wasm",
    "tree-sitter-python.wasm",
  ];
  const missing = needed.filter((n) => !existsSync(join(outDir, n)));
  if (missing.length) {
    console.error("[fetch-grammars] still missing:", missing.join(", "));
    process.exitCode = 1;
  } else {
    console.log("[fetch-grammars] all grammars ready in", outDir);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
