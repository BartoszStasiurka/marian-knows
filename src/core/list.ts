import { hasTag, inScope, scopeWarnings, validateScope, type DocFilterOptions } from "./filter.js";
import { openIndexReadonly } from "./indexer.js";
import type { LoadedConfig } from "./types.js";

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
