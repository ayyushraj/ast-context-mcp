import type { SymbolKind } from "../../store/schema.js";

export interface Range {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  container: string | null;
  range: Range;
  signature: string | null;
  typeText: string | null;
}

export interface ExtractedCall {
  calleeName: string;
  range: Range;
  /** enclosing function/method name if known */
  callerName: string | null;
}

export interface ExtractedImport {
  sourceModule: string;
  localName: string;
  importedName: string | null;
}

export interface ExtractResult {
  symbols: ExtractedSymbol[];
  calls: ExtractedCall[];
  imports: ExtractedImport[];
}

export function nodeRange(node: {
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}): Range {
  return {
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column,
  };
}

export function textSlice(
  source: string,
  node: { startIndex: number; endIndex: number }
): string {
  return source.slice(node.startIndex, node.endIndex);
}
