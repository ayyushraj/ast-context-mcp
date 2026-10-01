/**
 * JS, JSX, TS, and TSX share the TypeScript extractor: those grammars use
 * the same node names for functions, classes, and calls. Python does not.
 */
import type { Tree } from "web-tree-sitter";
import type { LanguageId } from "../languages.js";
import { extractPython } from "./python.js";
import { extractTypeScript } from "./typescript.js";
import type { ExtractResult } from "./types.js";

export function extractFromTree(
  lang: LanguageId,
  tree: Tree,
  source: string
): ExtractResult {
  if (lang === "python") return extractPython(tree, source);
  return extractTypeScript(tree, source);
}

export type { ExtractResult } from "./types.js";
