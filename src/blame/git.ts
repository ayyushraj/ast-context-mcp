import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export interface BlameLine {
  line: number;
  commit: string;
  author: string;
  authorMail: string;
  authorTime: string;
  summary: string;
  content: string;
}

export interface BlameResult {
  path: string;
  startLine: number;
  endLine: number;
  lines: BlameLine[];
}

/**
 * Run `git blame --line-porcelain` for a file (optional line range).
 */
export async function gitBlame(
  root: string,
  relativePath: string,
  opts: { startLine?: number; endLine?: number } = {}
): Promise<BlameResult> {
  const abs = resolve(root, relativePath);
  const args = ["blame", "--line-porcelain"];
  let startLine = opts.startLine;
  let endLine = opts.endLine;
  if (startLine != null && endLine != null && endLine < startLine) {
    const swap = startLine;
    startLine = endLine;
    endLine = swap;
  }
  if (startLine != null) {
    const end = endLine ?? startLine;
    args.push(`-L`, `${startLine},${end}`);
  }
  args.push("--", abs);

  let stdout: string;
  try {
    const result = await execFileAsync("git", args, {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
    });
    stdout = result.stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git blame failed for ${relativePath}: ${message}`);
  }

  const lines = parsePorcelain(stdout);
  return {
    path: relativePath,
    startLine: startLine ?? (lines[0]?.line ?? 1),
    endLine: endLine ?? (lines[lines.length - 1]?.line ?? 1),
    lines,
  };
}

function parsePorcelain(stdout: string): BlameLine[] {
  const lines: BlameLine[] = [];
  const chunks = stdout.split("\n");
  let i = 0;
  while (i < chunks.length) {
    const header = chunks[i];
    if (!header || !/^[0-9a-f]{40,}\s+\d+\s+\d+/.test(header)) {
      i++;
      continue;
    }
    const parts = header.split(/\s+/);
    const commit = parts[0]!;
    const lineNum = Number(parts[2]);
    let author = "";
    let authorMail = "";
    let authorTime = "";
    let summary = "";
    i++;
    while (i < chunks.length && !chunks[i]!.startsWith("\t")) {
      const row = chunks[i]!;
      if (row.startsWith("author ")) author = row.slice(7);
      else if (row.startsWith("author-mail ")) authorMail = row.slice(12);
      else if (row.startsWith("author-time ")) {
        const ts = Number(row.slice(12));
        authorTime = Number.isFinite(ts)
          ? new Date(ts * 1000).toISOString()
          : row.slice(12);
      } else if (row.startsWith("summary ")) summary = row.slice(8);
      i++;
    }
    let content = "";
    if (i < chunks.length && chunks[i]!.startsWith("\t")) {
      content = chunks[i]!.slice(1);
      i++;
    }
    lines.push({
      line: lineNum,
      commit: commit.slice(0, 12),
      author,
      authorMail,
      authorTime,
      summary,
      content,
    });
  }
  return lines;
}
