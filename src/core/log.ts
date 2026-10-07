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
export type SessionOp = "connect" | "disconnect";

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

/** MCP client name and version from the `initialize` request. */
export interface ClientInfo {
  name: string;
  version: string;
}

/** Start or end of an MCP session, in the same file as queries. */
export interface SessionLogEntry {
  ts: string;
  source: "mcp";
  who: string;
  op: SessionOp;
  /** Null when the client sent none. */
  client: ClientInfo | null;
  /** `disconnect` only: tool calls in the session, failed ones included. */
  calls?: number;
  /** `disconnect` only: session duration. */
  ms?: number;
}

export type LogEntry = QueryLogEntry | SessionLogEntry;

/** Why the HTTP server answered 401. `unknown` covers revoked tokens too. */
export type AccessDenial = "missing" | "malformed" | "unknown";

/** One line of `access-YYYY-MM-DD.jsonl`: a request the HTTP server rejected. Never the token itself. */
export interface AccessLogEntry {
  ts: string;
  status: 401;
  reason: AccessDenial;
  /** Peer address; behind a reverse proxy, the proxy's. */
  ip: string | null;
  /** `X-Forwarded-For` as sent, when present. */
  forwardedFor?: string;
  method: string;
  /** Request path without the query string. */
  path: string;
  userAgent: string | null;
}

export type AccessRecord = Omit<AccessLogEntry, "ts" | "status">;

export const isSessionEntry = (e: LogEntry): e is SessionLogEntry => e.op === "connect" || e.op === "disconnect";

export interface SessionRecord {
  who: string;
  op: SessionOp;
  client: ClientInfo | null;
  calls?: number;
  ms?: number;
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
/** Any dated log file (`queries-…`, `access-…`), for retention. */
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
  return appendEntry(config, entry, now);
}

/** Appends an MCP session start or end to today's (UTC) log. Same rules as `logQuery`. */
export function logSession(config: LoadedConfig, record: SessionRecord, now: Date = new Date()): string[] {
  if (logDisabled()) return [];
  const entry: SessionLogEntry = {
    ts: now.toISOString(),
    source: "mcp",
    who: record.who,
    op: record.op,
    client: record.client ? { name: record.client.name, version: record.client.version } : null,
  };
  if (record.calls !== undefined) entry.calls = record.calls;
  if (record.ms !== undefined) entry.ms = Math.round(record.ms);
  return appendEntry(config, entry, now);
}

/**
 * Appends a rejected HTTP request (401) to today's (UTC) access log. Not turned off by `MARIAN_KNOWS_NO_LOG`:
 * it is a security record, not a usage one. Never throws; returns warnings.
 */
export function logAccess(config: LoadedConfig, record: AccessRecord, now: Date = new Date()): string[] {
  const { forwardedFor, ...rest } = record;
  const entry: AccessLogEntry = {
    ts: now.toISOString(),
    status: 401,
    reason: rest.reason,
    ip: rest.ip,
    ...(forwardedFor !== undefined && { forwardedFor }),
    method: rest.method,
    path: rest.path,
    userAgent: rest.userAgent,
  };
  return appendLine(config, "access", entry, now);
}

function appendEntry(config: LoadedConfig, entry: LogEntry, now: Date): string[] {
  return appendLine(config, "queries", entry, now);
}

function appendLine(config: LoadedConfig, kind: "queries" | "access", entry: { ts: string }, now: Date): string[] {
  const dir = logDir(config);
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, `${kind}-${entry.ts.slice(0, 10)}.jsonl`), JSON.stringify(entry) + "\n");
  } catch (e) {
    const what = kind === "queries" ? "query" : "access";
    return [`cannot write the ${what} log (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`];
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
  /** Only queries with no results; session entries are left out. */
  zero?: boolean;
}

export interface ReadLogResult {
  /** Oldest first. */
  entries: LogEntry[];
  warnings: string[];
}

export const DEFAULT_LOG_DAYS = 7;

/** Reads the query log, session entries included. A missing log directory is an empty log; broken lines are skipped with a warning. */
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

  const entries: LogEntry[] = [];
  let broken = 0;
  for (const name of names.filter((n) => QUERY_FILE.test(n)).sort()) {
    // A file holds one UTC day; skip whole days before the window.
    if (QUERY_FILE.exec(name)![1]! < since.slice(0, 10)) continue;
    for (const line of readFileSync(path.join(dir, name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let entry: LogEntry;
      try {
        entry = JSON.parse(line) as LogEntry;
      } catch {
        broken++;
        continue;
      }
      if (typeof entry?.ts !== "string" || (!isSessionEntry(entry) && typeof entry.results !== "number")) {
        broken++;
        continue;
      }
      if (entry.ts < since || (options.zero && (isSessionEntry(entry) || entry.results !== 0))) continue;
      entries.push(entry);
    }
  }
  entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { entries, warnings: broken ? [`skipped ${broken} broken log line(s)`] : [] };
}
