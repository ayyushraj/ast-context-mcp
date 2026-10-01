/** Discovers source files, honoring .gitignore plus DEFAULT_IGNORE. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import { DEFAULT_IGNORE, INDEXABLE_EXTENSIONS } from "../config.js";
import { languageFromPath } from "./languages.js";

/** Skip generated or vendored blobs that are not useful as source context. */
const MAX_SOURCE_BYTES = 1_048_576;

export interface WalkedFile {
  absolutePath: string;
  relativePath: string;
  language: NonNullable<ReturnType<typeof languageFromPath>>;
  mtimeMs: number;
  size: number;
}

function loadGitignore(root: string): Ignore {
  const ig = ignore();
  ig.add(DEFAULT_IGNORE);
  const gi = join(root, ".gitignore");
  if (existsSync(gi)) {
    ig.add(readFileSync(gi, "utf8"));
  }
  return ig;
}

function isIndexable(relPath: string): boolean {
  const base = relPath.split(sep).pop() ?? relPath;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return false;
  return INDEXABLE_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

export function walkWorkspace(root: string): WalkedFile[] {
  const ig = loadGitignore(root);
  const out: WalkedFile[] = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = join(dir, ent.name);
      const rel = relative(root, abs);
      if (!rel || rel.startsWith("..")) continue;

      // ignore checks relative paths with forward slashes
      const relPosix = rel.split(sep).join("/");
      if (ig.ignores(relPosix) || ig.ignores(relPosix + "/")) continue;

      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!isIndexable(relPosix)) continue;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.size > MAX_SOURCE_BYTES) continue;

      const lang = languageFromPath(relPosix);
      if (!lang) continue;

      out.push({
        absolutePath: abs,
        relativePath: relPosix,
        language: lang,
        mtimeMs: st.mtimeMs,
        size: st.size,
      });
    }
  }

  walk(root);
  return out;
}
