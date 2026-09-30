import { readFileSync } from "node:fs";
import path from "node:path";
import { DocNotFoundError, InvalidPathError } from "./errors.js";
import { hasTag, inScope, scopeWarnings, validateScope, type DocFilterOptions } from "./filter.js";
import { openIndexReadonly } from "./indexer.js";
import type { LoadedConfig } from "./types.js";
import { validateVirtualPath } from "./virtual-path.js";

export interface ListItem {
  path: string;
  title: string | null;
  tags: string[];
}

export interface ListResult {
  /** Indexed files in scope, sorted by path (code point order). */
  docs: ListItem[];
  /** A valid scope that covers no indexed file. */
  warnings: string[];
}

/** Lists indexed files, filtered by scope and tag. */
export function list(config: LoadedConfig, options: DocFilterOptions = {}): ListResult {
  validateScope(options);
  const db = openIndexReadonly(config);
  try {
    const warnings = scopeWarnings(db, options);
    // BINARY collation compares UTF-8 bytes, which is code point order.
    const rows = db.prepare("SELECT path, title, tags FROM docs ORDER BY path").all() as {
      path: string;
      title: string | null;
      tags: string;
    }[];
    const docs = rows
      .map((r) => ({ path: r.path, title: r.title, tags: JSON.parse(r.tags) as string[] }))
      .filter((d) => inScope(d.path, options) && hasTag(d.tags, options.tag));
    return { docs, warnings };
  } finally {
    db.close();
  }
}

export interface GetResult {
  path: string;
  /** File content as it is on disk (UTF-8), not the normalized text the parser sees. */
  content: string;
}

/**
 * Reads an indexed file by its virtual path. Only paths present in the index are served, and the disk
 * path is resolved inside the source directory, so `get` never reads anything `list` would not show.
 */
export function getDoc(config: LoadedConfig, virtualPath: string): GetResult {
  const problems = validateVirtualPath(virtualPath);
  if (virtualPath.endsWith("/")) problems.push("must be a file path, not a directory");
  if (problems.length) throw new InvalidPathError(virtualPath, problems);

  const db = openIndexReadonly(config);
  try {
    if (!db.prepare("SELECT 1 FROM docs WHERE path = ?").get(virtualPath)) {
      throw new DocNotFoundError(virtualPath, `not in the index: ${virtualPath}`);
    }
  } finally {
    db.close();
  }

  const diskPath = path.join(config.sourceDir, ...virtualPath.split("/"));
  const rel = path.relative(config.sourceDir, diskPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new DocNotFoundError(virtualPath, `outside the source directory: ${virtualPath}`);
  }
  try {
    return { path: virtualPath, content: readFileSync(diskPath, "utf8") };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
    throw new DocNotFoundError(virtualPath, `cannot read ${virtualPath} (${code}); run: marian-knows index`);
  }
}
