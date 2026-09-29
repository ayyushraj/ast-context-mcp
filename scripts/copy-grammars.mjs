import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "grammars");
mkdirSync(outDir, { recursive: true });

function findWasm(pkgName, candidates) {
  let pkgRoot;
  try {
    pkgRoot = dirname(require.resolve(`${pkgName}/package.json`));
  } catch {
    return null;
  }
  for (const rel of candidates) {
    const p = join(pkgRoot, rel);
    if (existsSync(p)) return p;
  }
  // Fallback: scan package for *.wasm
  try {
    const files = readdirSync(pkgRoot, { recursive: true });
    for (const f of files) {
      if (typeof f === "string" && f.endsWith(".wasm")) {
        return join(pkgRoot, f);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

const grammars = [
  {
    name: "tree-sitter-javascript.wasm",
    pkg: "tree-sitter-javascript",
    candidates: [
      "tree-sitter-javascript.wasm",
      "javascript.wasm",
      "prebuilds/tree-sitter-javascript.wasm",
    ],
  },
  {
    name: "tree-sitter-typescript.wasm",
    pkg: "tree-sitter-typescript",
    candidates: [
      "tree-sitter-typescript.wasm",
      "typescript.wasm",
      "prebuilds/tree-sitter-typescript.wasm",
    ],
  },
  {
    name: "tree-sitter-tsx.wasm",
    pkg: "tree-sitter-typescript",
    candidates: [
      "tree-sitter-tsx.wasm",
      "tsx.wasm",
      "prebuilds/tree-sitter-tsx.wasm",
    ],
  },
  {
    name: "tree-sitter-python.wasm",
    pkg: "tree-sitter-python",
    candidates: [
      "tree-sitter-python.wasm",
      "python.wasm",
      "prebuilds/tree-sitter-python.wasm",
    ],
  },
];

let ok = 0;
for (const g of grammars) {
  const src = findWasm(g.pkg, g.candidates);
  if (!src) {
    console.warn(`[copy-grammars] missing WASM for ${g.name} (pkg=${g.pkg})`);
    continue;
  }
  copyFileSync(src, join(outDir, g.name));
  console.log(`[copy-grammars] ${g.name} <- ${src}`);
  ok++;
}

// Also copy web-tree-sitter runtime wasm (package.json may not be exportable)
try {
  const wtsEntry = require.resolve("web-tree-sitter");
  const wtsDir = dirname(wtsEntry);
  const runtimeCandidates = [
    join(wtsDir, "tree-sitter.wasm"),
    join(wtsDir, "..", "tree-sitter.wasm"),
    join(root, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
    join(root, "node_modules", "web-tree-sitter", "debug", "tree-sitter.wasm"),
  ];
  for (const c of runtimeCandidates) {
    if (existsSync(c)) {
      copyFileSync(c, join(outDir, "tree-sitter.wasm"));
      console.log(`[copy-grammars] tree-sitter.wasm <- ${c}`);
      ok++;
      break;
    }
  }
} catch (e) {
  console.warn("[copy-grammars] web-tree-sitter runtime wasm not found", e);
}

if (ok === 0) {
  console.warn(
    "[copy-grammars] No WASM files copied. Install tree-sitter-* packages or place .wasm under grammars/."
  );
}
