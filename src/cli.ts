#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  CONFIG_FILENAME,
  ConfigError,
  IndexMissingError,
  destroyIndex,
  findConfig,
  get as getRef,
  indexDirName,
  initConfig,
  isSessionEntry,
  list as listIndex,
  loadConfig,
  logQuery,
  parseFile,
  readQueryLog,
  scanSource,
  search as searchIndex,
  status as projectStatus,
  syncIndex,
  type DocFilterOptions,
  type LoadedConfig,
  type LogEntry,
  type ParsedDoc,
  type ProjectStatus,
  type QueryRecord,
  type TokenInfo,
  addToken,
  listTokens,
  revokeToken,
  tokensPath,
} from "./core/index.js";
import { serveHttp, serveStdio } from "./mcp.js";

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";

const USAGE = `Usage: marian-knows <command> [options]

Commands:
  init <project_name>   Create a minimal marian-knows.yml (never overwrites)
  scan                  Scan the source directory and print virtual paths (dry run, no index)
  parse <file>          Parse a Markdown file given by disk path (diagnostic, no config needed)
  index [--full]        Sync the index (.marian-knows/<config name>/ next to the config)
  search <query>        Search the index, one virtual path per line (exit 1: no results)
  list                  List indexed files sorted by path (exit 1: no files)
  get <path>[#anchor]   Print an indexed file, or one section of it, by virtual path
  status                Show project, config and index state
  destroy               Remove this config's index and query logs; the config stays
  log                   Show the query log (search, get, list, MCP sessions), last 7 days
  serve [--http]        Run the MCP server over stdio, or over HTTP (tools: search, get, list, status)
  token add <name>      Create an HTTP access token; it is printed once
  token list            List token names and dates (never the tokens)
  token revoke <name>   Revoke a token; a running server rejects it from the next request on
  help                  Show this help

Options:
  --config <file>          Path to marian-knows.yml (for init: the file to create)
  --json                   JSON output (scan, parse, search, list, status, log, token list)
  --disk                   Include disk paths (scan; diagnostic only)
  --full                   Rebuild the index from scratch (index)
  -n <limit>               Max number of files (search; default 10)
  --exact                  No word trimming, no prefix match, no OR fallback (search)
  --tag <tag>              Only files with this tag (search, list)
  --path <prefix>          Only this subtree ('/dir/') or file ('/a.md'); repeatable (search, list)
  --exclude-path <prefix>  Leave out a subtree or file; repeatable (search, list)
  --snippets               Print a snippet under each path, matches in [...] (search)
  --max-chars <n>          Cut the output after n characters, 0 = no limit (get; default 20000)
  --days <n>               Entries from the last n days (log; default 7)
  --zero                   Only queries with no results (log)
  --http                   Serve MCP over Streamable HTTP at /mcp, bearer token required (serve)
  --port <n>               HTTP port (serve --http; default ${DEFAULT_PORT}, 0 = any free port)
  --host <addr>            HTTP listen address (serve --http; default ${DEFAULT_HOST}, 0.0.0.0 = all)
  -h, --help               Show this help`;

const OPTIONS = {
  config: { type: "string" },
  json: { type: "boolean" },
  disk: { type: "boolean" },
  full: { type: "boolean" },
  limit: { type: "string", short: "n" },
  exact: { type: "boolean" },
  tag: { type: "string" },
  path: { type: "string", multiple: true },
  "exclude-path": { type: "string", multiple: true },
  snippets: { type: "boolean" },
  "max-chars": { type: "string" },
  days: { type: "string" },
  zero: { type: "boolean" },
  http: { type: "boolean" },
  port: { type: "string" },
  host: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

/** Positional arguments each command takes after its name (search: any number of query words). */
const ARITY: Record<string, number> = {
  init: 1,
  scan: 0,
  parse: 1,
  index: 0,
  list: 0,
  get: 1,
  status: 0,
  destroy: 0,
  log: 0,
  serve: 0,
  token: 2,
};

const warn = (warnings: string[]) => {
  for (const w of warnings) console.error(`! warning: ${w}`);
};

/** Parses a non-negative integer option; prints an error and returns null when it is not one. */
function intOption(name: string, value: string, min: number): number | null {
  const n = /^\d+$/.test(value) ? Number(value) : NaN;
  if (n >= min) return n;
  console.error(`error: ${name} expects ${min > 0 ? "a positive" : "a non-negative"} integer, got '${value}'`);
  return null;
}

/** Appends a CLI entry to the query log; a failed write is only a warning. */
function logCli(config: LoadedConfig, record: Omit<QueryRecord, "source" | "who">): void {
  warn(logQuery(config, { source: "cli", who: "cli", ...record }));
}

/** Finds and loads the config; prints an error and returns null when there is none. */
function requireConfig(explicit: string | undefined): LoadedConfig | null {
  const configPath = findConfig({ explicit });
  if (!configPath) {
    console.error("error: config not found. Use --config, MARIAN_KNOWS_CONFIG or run: marian-knows init <project_name>");
    return null;
  }
  return loadConfig(configPath);
}

async function scan(values: { config?: string; json?: boolean; disk?: boolean }): Promise<number> {
  const config = requireConfig(values.config);
  if (!config) return 2;
  const { files, warnings } = await scanSource(config);
  warn(warnings);

  if (values.json) {
    console.log(
      JSON.stringify(files.map((f) => (values.disk ? { path: f.virtualPath, disk: f.diskPath } : { path: f.virtualPath }))),
    );
  } else {
    for (const f of files) console.log(values.disk ? `${f.virtualPath}\t${f.diskPath}` : f.virtualPath);
  }
  console.error(`Files: ${files.length}`);
  return 0;
}

async function index(values: { config?: string; full?: boolean }): Promise<number> {
  const config = requireConfig(values.config);
  if (!config) return 2;
  const started = performance.now();
  const r = await syncIndex(config, { full: values.full });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`Files: ${r.files}`);
  console.log(`+ ${r.added} added, ~ ${r.changed} changed, - ${r.removed} removed (${seconds} s)`);
  warn(r.warnings);
  return 0;
}

interface FilterValues {
  tag?: string;
  path?: string[];
  "exclude-path"?: string[];
}

const filterOptions = (values: FilterValues): DocFilterOptions => ({
  tag: values.tag,
  paths: values.path,
  excludePaths: values["exclude-path"],
});

async function search(
  words: string[],
  values: FilterValues & { config?: string; limit?: string; exact?: boolean; snippets?: boolean; json?: boolean },
): Promise<number> {
  const query = words.join(" ");
  if (!query.trim()) {
    console.error("error: missing <query>. Usage: marian-knows search <query> [options]");
    return 2;
  }
  let limit: number | undefined;
  if (values.limit !== undefined) {
    const n = intOption("-n", values.limit, 1);
    if (n === null) return 2;
    limit = n;
  }
  const config = requireConfig(values.config);
  if (!config) return 2;
  const started = performance.now();
  const filters = { ...filterOptions(values), limit, exact: values.exact };
  const { hits, warnings } = searchIndex(config, query, { ...filters, snippets: values.snippets });
  warn(warnings);
  logCli(config, { op: "search", query, filters, paths: hits.map((h) => h.path), ms: performance.now() - started });
  if (values.json) {
    console.log(JSON.stringify(hits));
  } else {
    for (const h of hits) {
      console.log(h.path);
      if (h.snippet) console.log(`  ${h.snippet}`);
    }
  }
  return hits.length ? 0 : 1;
}

function list(values: FilterValues & { config?: string; json?: boolean }): number {
  const config = requireConfig(values.config);
  if (!config) return 2;
  const started = performance.now();
  const { docs, warnings } = listIndex(config, filterOptions(values));
  warn(warnings);
  logCli(config, {
    op: "list",
    query: null,
    filters: filterOptions(values),
    paths: docs.map((d) => d.path),
    ms: performance.now() - started,
  });
  if (values.json) console.log(JSON.stringify(docs));
  else for (const d of docs) console.log(d.path);
  return docs.length ? 0 : 1;
}

function get(ref: string | undefined, values: { config?: string; "max-chars"?: string }): number {
  if (ref === undefined) {
    console.error("error: missing <path>. Usage: marian-knows get <path>[#anchor]");
    return 2;
  }
  let maxChars: number | undefined;
  if (values["max-chars"] !== undefined) {
    const n = intOption("--max-chars", values["max-chars"], 0);
    if (n === null) return 2;
    maxChars = n;
  }
  const config = requireConfig(values.config);
  if (!config) return 2;
  const started = performance.now();
  const doc = getRef(config, ref, { maxChars });
  process.stdout.write(doc.content);
  logCli(config, { op: "get", query: ref, paths: [doc.path], ms: performance.now() - started });
  return 0;
}

function formatLogEntry(e: LogEntry): string {
  const time = e.ts.slice(0, 19).replace("T", " ");
  if (isSessionEntry(e)) {
    const client = e.client ? `${e.client.name} ${e.client.version}` : "-";
    const end = e.op === "disconnect" ? `  ${e.calls ?? 0} calls  ${formatAge(Math.round((e.ms ?? 0) / 1000))}` : "";
    return `${time}  ${e.who}  ${e.op}  ${client}${end}`;
  }
  const filters = Object.keys(e.filters ?? {}).length ? `  ${JSON.stringify(e.filters)}` : "";
  const query = e.query === null ? "-" : JSON.stringify(e.query);
  return `${time}  ${e.who}  ${e.op}  ${e.results}  ${query}${filters}`;
}

function log(values: { config?: string; days?: string; zero?: boolean; json?: boolean }): number {
  let days: number | undefined;
  if (values.days !== undefined) {
    const n = intOption("--days", values.days, 1);
    if (n === null) return 2;
    days = n;
  }
  const config = requireConfig(values.config);
  if (!config) return 2;
  const { entries, warnings } = readQueryLog(config, { days, zero: values.zero });
  warn(warnings);
  if (values.json) console.log(JSON.stringify(entries));
  else for (const e of entries) console.log(formatLogEntry(e));
  return entries.length ? 0 : 1;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86400)} d`;
}

function printStatus(s: ProjectStatus): void {
  console.log(`Project: ${s.name}`);
  if (s.description !== null) console.log(`Description: ${s.description}`);
  console.log(`Config: ${s.config}`);
  console.log(`Source: ${s.path}${s.pathExists ? "" : " (missing)"}`);
  console.log(`Exclude: ${s.exclude.length ? s.exclude.join(", ") : "-"}`);
  if (s.index === "missing") {
    console.log("Index: none (run: marian-knows index)");
    return;
  }
  if (s.index === "outdated") {
    console.log("Index: outdated schema (run: marian-knows index)");
    return;
  }
  console.log(`Index: ${s.files} files, ${s.sections} sections, ${formatBytes(s.dbSize ?? 0)}`);
  const age = s.ageSeconds === null ? "" : ` (${formatAge(s.ageSeconds)} ago)`;
  console.log(`Indexed at: ${s.indexedAt ?? "-"}${age}`);
}

function status(values: { config?: string; json?: boolean }): number {
  const config = requireConfig(values.config);
  if (!config) return 2;
  const s = projectStatus(config);
  if (values.json) console.log(JSON.stringify(s));
  else printStatus(s);
  return 0;
}

function destroy(values: { config?: string }): number {
  const config = requireConfig(values.config);
  if (!config) return 2;
  console.log(destroyIndex(config) ? `Removed the index (${indexDirName(config)}/)` : "No index to remove");
  return 0;
}

async function serve(values: { config?: string; http?: boolean; port?: string; host?: string }): Promise<number> {
  if (!values.http && (values.port !== undefined || values.host !== undefined)) {
    console.error("error: --port and --host need --http");
    return 2;
  }
  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    const n = intOption("--port", values.port, 0);
    if (n === null) return 2;
    if (n > 65535) {
      console.error(`error: --port must be at most 65535, got ${n}`);
      return 2;
    }
    port = n;
  }
  const config = requireConfig(values.config);
  if (!config) return 2;
  if (values.http) {
    // Lives until SIGINT / SIGTERM.
    await serveHttp(config, { port, host: values.host ?? DEFAULT_HOST, tokensFile: tokensPath(config) });
    return 0;
  }
  // stdout carries the MCP protocol; the process lives until the client closes stdin.
  await serveStdio(config);
  return 0;
}

const TOKEN_USAGE = "Usage: marian-knows token add <name> | token list | token revoke <name>";

function formatToken(t: TokenInfo): string {
  const date = (iso: string | null) => (iso === null ? "never" : iso.slice(0, 19).replace("T", " "));
  return `${t.name}  created ${date(t.createdAt)}  last used ${date(t.lastUsedAt)}`;
}

function token(args: string[], values: { config?: string; json?: boolean }): number {
  const [action, name] = args;
  if (action !== "add" && action !== "list" && action !== "revoke") {
    const problem = action === undefined ? "missing token action" : `unknown token action: ${action}`;
    console.error(`error: ${problem}. ${TOKEN_USAGE}`);
    return 2;
  }
  if (action === "list" ? name !== undefined : name === undefined) {
    const problem = name === undefined ? "missing <name>" : `unexpected argument '${name}' for token list`;
    console.error(`error: ${problem}. ${TOKEN_USAGE}`);
    return 2;
  }
  const config = requireConfig(values.config);
  if (!config) return 2;
  const file = tokensPath(config);
  switch (action) {
    case "add":
      // The token alone on stdout, so a script can capture it; the note goes to stderr.
      console.log(addToken(file, name!));
      console.error(`Token '${name!.trim()}' created. It is shown only now; store it. Keep ${file} out of git.`);
      return 0;
    case "list": {
      const tokens = listTokens(file);
      if (values.json) console.log(JSON.stringify(tokens));
      else for (const t of tokens) console.log(formatToken(t));
      return tokens.length ? 0 : 1;
    }
    case "revoke":
      revokeToken(file, name!);
      console.log(`Revoked '${name!.trim()}'`);
      return 0;
  }
}

const PREVIEW_CHARS = 80;

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

function printParsed(doc: ParsedDoc): void {
  console.log(`Title: ${doc.title}`);
  console.log(`Tags: ${doc.tags.length ? doc.tags.join(", ") : "-"}`);
  console.log(`Frontmatter: ${doc.frontmatter ? JSON.stringify(doc.frontmatter) : "-"}`);
  console.log(`Sections: ${doc.sections.length}`);
  for (const s of doc.sections) {
    const head = s.level === null ? "(before first heading)" : `${"#".repeat(s.level)} ${s.heading}  #${s.anchor}`;
    console.log(`\n[${s.ord}] ${head}  (${s.body.length} chars)`);
    if (s.body) console.log(`  ${preview(s.body)}`);
  }
}

function parse(file: string | undefined, values: { json?: boolean }): number {
  if (file === undefined) {
    console.error("error: missing <file>. Usage: marian-knows parse <file> [--json]");
    return 2;
  }
  let doc: ParsedDoc;
  try {
    doc = parseFile(file);
  } catch (e) {
    console.error(`error: cannot read ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    return 2;
  }
  warn(doc.warnings);
  if (values.json) {
    const { warnings: _, ...rest } = doc;
    console.log(JSON.stringify(rest));
  } else {
    printParsed(doc);
  }
  return 0;
}

function init(name: string | undefined, values: { config?: string }): number {
  if (name === undefined) {
    console.error("error: missing <project_name>. Usage: marian-knows init <project_name>");
    return 2;
  }
  const written = initConfig(values.config ?? CONFIG_FILENAME, name);
  console.log(`Created ${written}`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }

  const { values, positionals } = parsed;
  const [command, ...args] = positionals;

  if (values.help || command === "help" || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 2;
  }

  const arity = ARITY[command];
  if (arity !== undefined && args.length > arity) {
    console.error(`error: unexpected argument '${args[arity]}' for ${command}`);
    return 2;
  }

  try {
    switch (command) {
      case "scan":
        return await scan(values);
      case "init":
        return init(args[0], values);
      case "parse":
        return parse(args[0], values);
      case "index":
        return await index(values);
      case "search":
        return await search(args, values);
      case "list":
        return list(values);
      case "get":
        return get(args[0], values);
      case "status":
        return status(values);
      case "destroy":
        return destroy(values);
      case "log":
        return log(values);
      case "serve":
        return await serve(values);
      case "token":
        return token(args, values);
      default:
        console.error(`error: unknown command: ${command}\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof ConfigError) {
      for (const err of e.errors) console.error(`error: ${err}`);
      return 2;
    }
    if (e instanceof IndexMissingError) {
      console.error(e.message);
      return 2;
    }
    // IndexLockedError, InvalidPathError, DocNotFoundError, TokenError and anything unexpected: exit 2, never 1
    // (that means "no results").
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
