import fg from "fast-glob";
import path from "node:path";
import type { LoadedConfig, ScanResult, ScannedFile } from "./types.js";

export const MAX_FILE_BYTES = 1024 * 1024;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function admit(f: ScannedFile, warnings: string[]): boolean {
  const name = path.posix.basename(f.virtualPath);
  if (/[#?]/.test(name)) {
    warnings.push(`skipped ${f.virtualPath}: file name contains '#' or '?'`);
    return false;
  }
  if (f.size > MAX_FILE_BYTES) {
    warnings.push(`skipped ${f.virtualPath}: larger than 1 MB`);
    return false;
  }
  return true;
}

/**
 * Resolves the source directory into the final set of indexable files (virtual path -> disk path).
 * Pure diagnostics for now: no index is written.
 */
export async function scanSource(config: LoadedConfig): Promise<ScanResult> {
  const warnings: string[] = [];
  if (!config.sourceExists) {
    warnings.push(`source directory does not exist: ${config.sourceDir}`);
    return { files: [], warnings };
  }

  const entries = await fg("**/*.md", {
    cwd: config.sourceDir,
    dot: false,
    onlyFiles: true,
    stats: true,
    objectMode: true,
    caseSensitiveMatch: false,
    suppressErrors: true,
    ignore: ["**/node_modules/**", ...config.exclude],
  });

  const candidates = entries
    .map((e) => ({
      virtualPath: "/" + e.path.normalize("NFC"),
      diskPath: path.join(config.sourceDir, e.path),
      size: e.stats?.size ?? 0,
    }))
    .filter((f) => admit(f, warnings))
    .sort((a, b) => cmp(a.virtualPath, b.virtualPath));

  // Case collisions anywhere in the path: first (code point order) wins.
  const files: ScannedFile[] = [];
  const winners = new Map<string, string>();
  for (const f of candidates) {
    const key = f.virtualPath.toLowerCase();
    const winner = winners.get(key);
    if (winner !== undefined) {
      warnings.push(`skipped ${f.virtualPath}: name differs only by case from ${winner}`);
      continue;
    }
    winners.set(key, f.virtualPath);
    files.push(f);
  }

  return { files, warnings };
}
