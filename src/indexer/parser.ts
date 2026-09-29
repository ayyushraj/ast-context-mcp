import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Tree } from "web-tree-sitter";
import { grammarWasmName, type LanguageId } from "./languages.js";

let initPromise: Promise<void> | null = null;
const languageCache = new Map<LanguageId, Language>();

function grammarsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "grammars"),
    join(process.cwd(), "grammars"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "tree-sitter.wasm"))) return c;
  }
  return candidates[0]!;
}

export async function initParser(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const dir = grammarsDir();
      const wasmPath = join(dir, "tree-sitter.wasm");
      if (!existsSync(wasmPath)) {
        throw new Error(
          `Missing tree-sitter.wasm at ${wasmPath}. Run npm install / npm run build.`
        );
      }
      await Parser.init({
        locateFile: (scriptName: string) => {
          if (scriptName.endsWith(".wasm")) {
            return join(dir, scriptName);
          }
          return scriptName;
        },
      });
    })();
  }
  await initPromise;
}

export async function loadLanguage(lang: LanguageId): Promise<Language> {
  await initParser();
  const cached = languageCache.get(lang);
  if (cached) return cached;

  const dir = grammarsDir();
  const wasm = join(dir, grammarWasmName(lang));
  if (!existsSync(wasm)) {
    throw new Error(
      `Missing grammar WASM: ${wasm}. Run npm install to copy grammars.`
    );
  }
  const language = await Language.load(readFileSync(wasm));
  languageCache.set(lang, language);
  return language;
}

export async function parseSource(
  lang: LanguageId,
  source: string
): Promise<{ tree: Tree; parser: Parser }> {
  const language = await loadLanguage(lang);
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  if (!tree) {
    parser.delete();
    throw new Error(`Failed to parse ${lang} source`);
  }
  return { tree, parser };
}
