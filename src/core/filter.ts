import type Database from "better-sqlite3";
import { InvalidPathError } from "./errors.js";
import { validateVirtualPath } from "./virtual-path.js";

/** Filters shared by `search` and `list`. All of them AND together. */
export interface DocFilterOptions {
  /** Only files with this tag (case-insensitive). */
  tag?: string;
  /** Scope: `/dir/` = subtree, `/file.md` = one file. Several = OR. Empty or missing = everything. */
  paths?: string[];
  /** Subtrees or files taken out of the scope. */
  excludePaths?: string[];
}

/** Throws InvalidPathError on the first scope path with broken syntax. */
export function validateScope(options: DocFilterOptions): void {
  for (const p of [...(options.paths ?? []), ...(options.excludePaths ?? [])]) {
    const problems = validateVirtualPath(p);
    if (problems.length) throw new InvalidPathError(p, problems);
  }
}

/** A trailing `/` covers a directory at any depth (`/a/` does not cover `/ab/x.md`); otherwise one file. */
export function matchesPath(virtualPath: string, scope: string): boolean {
  return scope.endsWith("/") ? virtualPath.startsWith(scope) : virtualPath === scope;
}

export function inScope(virtualPath: string, options: DocFilterOptions): boolean {
  const { paths = [], excludePaths = [] } = options;
  if (paths.length && !paths.some((p) => matchesPath(virtualPath, p))) return false;
  return !excludePaths.some((p) => matchesPath(virtualPath, p));
}

export function hasTag(tags: string[], tag: string | undefined): boolean {
  if (tag === undefined) return true;
  const wanted = tag.normalize("NFC").trim().toLowerCase();
  return tags.some((t) => t.toLowerCase() === wanted);
}

/**
 * Warnings for a valid scope that covers no indexed file: one per `--path` without files, or one for
 * the whole scope when exclusions empty it. No scope given = no warnings.
 */
export function scopeWarnings(db: Database.Database, options: DocFilterOptions): string[] {
  const { paths = [], excludePaths = [] } = options;
  if (!paths.length && !excludePaths.length) return [];
  const all = (db.prepare("SELECT path FROM docs").all() as { path: string }[]).map((r) => r.path);

  const warnings = paths
    .filter((p) => !all.some((d) => matchesPath(d, p)))
    .map((p) => (p.endsWith("/") ? `no indexed files under ${p}` : `not in the index: ${p}`));
  if (!warnings.length && !all.some((d) => inScope(d, options))) warnings.push("no indexed files in scope");
  return warnings;
}
