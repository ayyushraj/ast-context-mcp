/** SHA-256 of file bytes. Used as the incremental-index key, not a security hash. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function hashBuffer(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function hashFile(filePath: string): string {
  return hashBuffer(readFileSync(filePath));
}
