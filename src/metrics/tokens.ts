/**
 * Rough token estimator for portfolio / debrief metrics.
 * Uses ~4 chars per token (common English/code heuristic) — not a model tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

export interface TokenCompareRow {
  scenario: string;
  tokens: number;
  description: string;
}

export interface TokenSavingsReport {
  filePath: string;
  fileLines: number;
  naiveFullFileTokens: number;
  structuredToolTokens: number;
  tokensSaved: number;
  savingsPercent: number;
  rows: TokenCompareRow[];
}

/** Compare stuffing a full source file into context vs compact structured tool JSON. */
export function compareFileVsTools(opts: {
  filePath: string;
  sourceText: string;
  listFileSymbolsJson: string;
  getDefinitionJson: string;
}): TokenSavingsReport {
  const fileLines = opts.sourceText.split(/\r?\n/).length;
  const naive = estimateTokens(opts.sourceText);
  const listTok = estimateTokens(opts.listFileSymbolsJson);
  const defTok = estimateTokens(opts.getDefinitionJson);
  const structured = listTok + defTok;
  const saved = Math.max(0, naive - structured);
  const pct = naive > 0 ? Math.round((saved / naive) * 1000) / 10 : 0;

  return {
    filePath: opts.filePath,
    fileLines,
    naiveFullFileTokens: naive,
    structuredToolTokens: structured,
    tokensSaved: saved,
    savingsPercent: pct,
    rows: [
      {
        scenario: "Naive: feed full source file to LLM",
        tokens: naive,
        description: `${fileLines} lines of raw source`,
      },
      {
        scenario: "Tool: list_file_symbols",
        tokens: listTok,
        description: "Structured file outline JSON",
      },
      {
        scenario: "Tool: get_definition",
        tokens: defTok,
        description: "Single definition + optional snippet",
      },
      {
        scenario: "Tools combined (outline + definition)",
        tokens: structured,
        description: "Typical agent navigation payload",
      },
    ],
  };
}

export function renderTokenSavingsHuman(report: TokenSavingsReport): string {
  const defRow = report.rows.find((r) => r.scenario.includes("get_definition"));
  const defTok = defRow?.tokens ?? 0;
  const defSaved = Math.max(0, report.naiveFullFileTokens - defTok);
  const defPct =
    report.naiveFullFileTokens > 0
      ? Math.round((defSaved / report.naiveFullFileTokens) * 1000) / 10
      : 0;

  const lines = [
    `Token savings vs full-file context (${report.filePath}, ${report.fileLines} lines)`,
    `  Naive full file:           ~${formatTokens(report.naiveFullFileTokens)} tokens`,
    `  get_definition alone:      ~${formatTokens(defTok)} tokens  (−${formatTokens(defSaved)}, ${defPct}%)`,
    `  list_file_symbols+def:     ~${formatTokens(report.structuredToolTokens)} tokens  (−${formatTokens(report.tokensSaved)}, ${report.savingsPercent}%)`,
    ``,
    `  Heuristic: chars/4 (not a model tokenizer). Compact tool JSON (no pretty-print).`,
  ];
  return lines.join("\n");
}
