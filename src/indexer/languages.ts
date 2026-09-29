export type LanguageId = "typescript" | "tsx" | "javascript" | "python";

const EXT_MAP: Record<string, LanguageId> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
};

export function languageFromPath(filePath: string): LanguageId | null {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_MAP[lower.slice(dot)] ?? null;
}

export function grammarWasmName(lang: LanguageId): string {
  switch (lang) {
    case "typescript":
      return "tree-sitter-typescript.wasm";
    case "tsx":
      return "tree-sitter-tsx.wasm";
    case "javascript":
      return "tree-sitter-javascript.wasm";
    case "python":
      return "tree-sitter-python.wasm";
  }
}
