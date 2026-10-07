import { appendFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { indexDir } from "./indexer.js";
import type { LoadedConfig } from "./types.js";

export const LOG_DIRNAME = "logs";
/** Log files older than this many days are deleted on write. */
export const LOG_RETENTION_DAYS = 90;
/** Set to anything but empty or `0` to turn the query log off. */
export const NO_LOG_ENV = "MARIAN_KNOWS_NO_LOG";
/** At most this many virtual paths are stored per entry. */
export const LOG_TOP = 5;

export type LogSource = "cli" | "mcp";
export type LogOp = "search" | "get" | "list";

/** One line of `queries-YYYY-MM-DD.jsonl`. Virtual paths only, never response content or disk paths. */
export interface QueryLogEntry {
  /** ISO 8601, UTC. */
  ts: string;
  source: LogSource;
  /** `cli`, `local` (MCP over stdio) or a token name. */
  who: string;
  op: LogOp;
  /** Search query or `get` reference (`path#anchor`); null for `list`. */
  query: string | null;
  /** Filters actually given (`tag`, `paths`, `excludePaths`, `limit`, `exact`); unset ones are left out. */
  filters: Record<string, unknown>;
  /** Number of results (files for `search` / `list`, 1 for a served `get`). */
  results: number;
  /** Up to `LOG_TOP` virtual paths, in result order. */
  top: string[];
  ms: number;
}

export interface QueryRecord {
  source: LogSource;
  who: string;
  op: LogOp;
  query: string | null;
  filters?: object;
  /** Every result path; the count and the top `LOG_TOP` are taken from it. */
  paths: string[];
  ms: number;
}

const QUERY_FILE = /^queries-(\d{4}-\d{2}-\d{2})\.jsonl$/;
/** Any dated log file (`queries-…`, later `access-…`), for retention. */
const DATED_FILE = /^[a-z]+-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DAY_MS = 86_400_000;

export function logDir(config: LoadedConfig): string {
  return path.join(indexDir(config), LOG_DIRNAME);
}

export function logDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[NO_LOG_ENV];
  return value !== undefined && value !== "" && value !== "0";
}

/**
 * Appends one entry to today's (UTC) query log and deletes dated log files past retention.
 * Never throws: returns warnings for the caller to print. Does nothing when the log is disabled.
 */
export function logQuery(config: LoadedConfig, record: QueryRecord, now: Date = new Date()): string[] {
  if (logDisabled()) return [];
  const entry: QueryLogEntry = {
    ts: now.toISOString(),
    source: record.source,
    who: record.who,
    op: record.op,
    query: record.query,
    filters: Object.fromEntries(
      Object.entries(record.filters ?? {}).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)),
    ),
    results: record.paths.length,
    top: record.paths.slice(0, LOG_TOP),
    ms: Math.round(record.ms),
  };
  const dir = logDir(config);
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, `queries-${entry.ts.slice(0, 10)}.jsonl`), JSON.stringify(entry) + "\n");
  } catch (e) {
    return [`cannot write the query log (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`];
  }
  return pruneLogs(dir, now);
}

/** Deletes dated log files older than `LOG_RETENTION_DAYS`, judged by the date in the file name. */
function pruneLogs(dir: string, now: Date): string[] {
  const oldest = new Date(now.getTime() - LOG_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
  try {
    for (const name of readdirSync(dir)) {
      const date = DATED_FILE.exec(name)?.[1];
      if (date && date < oldest) unlinkSync(path.join(dir, name));
    }
  } catch (e) {
    return [`cannot prune old query logs (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`];
  }
  return [];
}

export interface ReadLogOptions {
  /** Entries from the last `days` × 24 h; default 7. */
  days?: number;
  /** Only entries with no results. */
  zero?: boolean;
}

export interface ReadLogResult {
  /** Oldest first. */
  entries: QueryLogEntry[];
  warnings: string[];
}

export const DEFAULT_LOG_DAYS = 7;

/** Reads the query log. A missing log directory is an empty log; broken lines are skipped with a warning. */
export function readQueryLog(config: LoadedConfig, options: ReadLogOptions = {}, now: Date = new Date()): ReadLogResult {
  const since = new Date(now.getTime() - (options.days ?? DEFAULT_LOG_DAYS) * DAY_MS).toISOString();
  const dir = logDir(config);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], warnings: [] };
    throw e;
  }

  const entries: QueryLogEntry[] = [];
  let broken = 0;
  for (const name of names.filter((n) => QUERY_FILE.test(n)).sort()) {
    // A file holds one UTC day; skip whole days before the window.
    if (QUERY_FILE.exec(name)![1]! < since.slice(0, 10)) continue;
    for (const line of readFileSync(path.join(dir, name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let entry: QueryLogEntry;
      try {
        entry = JSON.parse(line) as QueryLogEntry;
      } catch {
        broken++;
        continue;
      }
      if (typeof entry?.ts !== "string" || typeof entry.results !== "number") {
        broken++;
        continue;
      }
      if (entry.ts < since || (options.zero && entry.results !== 0)) continue;
      entries.push(entry);
    }
  }
  entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { entries, warnings: broken ? [`skipped ${broken} broken log line(s)`] : [] };
}
