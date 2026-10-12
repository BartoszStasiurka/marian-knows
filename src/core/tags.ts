import type Database from "better-sqlite3";
import { inScope, scopeWarnings, validateScope, type DocFilterOptions } from "./filter.js";
import { openIndexReadonly } from "./indexer.js";
import type { LoadedConfig } from "./types.js";

export interface TagCount {
  tag: string;
  /** Number of files with this tag. */
  count: number;
}

export interface TagsResult {
  /** Most common first; equal counts sorted by tag. */
  tags: TagCount[];
  /** A valid scope that covers no indexed file. */
  warnings: string[];
}

export type TagsOptions = Pick<DocFilterOptions, "paths" | "excludePaths">;

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Counts files per tag in scope. Tags group case-insensitively, as `--tag` matches them; a group shows its most
 * common spelling (on a tie, the first in code point order).
 */
export function countTags(db: Database.Database, options: TagsOptions = {}): TagCount[] {
  const rows = db.prepare("SELECT path, tags FROM docs").all() as { path: string; tags: string }[];
  const groups = new Map<string, { files: number; spellings: Map<string, number> }>();
  for (const row of rows) {
    if (!inScope(row.path, options)) continue;
    const seen = new Set<string>();
    for (const tag of JSON.parse(row.tags) as string[]) {
      const key = tag.toLowerCase();
      const group = groups.get(key) ?? { files: 0, spellings: new Map<string, number>() };
      groups.set(key, group);
      group.spellings.set(tag, (group.spellings.get(tag) ?? 0) + 1);
      // One file counts once, even with two spellings of the same tag.
      if (!seen.has(key)) {
        seen.add(key);
        group.files++;
      }
    }
  }
  const tags = [...groups.values()].map(({ files, spellings }) => {
    const [tag] = [...spellings].sort(([a, m], [b, n]) => n - m || byCodePoint(a, b))[0]!;
    return { tag, count: files };
  });
  return tags.sort((a, b) => b.count - a.count || byCodePoint(a.tag.toLowerCase(), b.tag.toLowerCase()));
}

/** Tags of indexed files with file counts, filtered by scope. */
export function listTags(config: LoadedConfig, options: TagsOptions = {}): TagsResult {
  validateScope(options);
  const db = openIndexReadonly(config);
  try {
    return { tags: countTags(db, options), warnings: scopeWarnings(db, options) };
  } finally {
    db.close();
  }
}
