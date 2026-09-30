#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  CONFIG_FILENAME,
  ConfigError,
  IndexMissingError,
  destroyIndex,
  findConfig,
  getDoc,
  initConfig,
  list as listIndex,
  loadConfig,
  parseFile,
  scanSource,
  search as searchIndex,
  status as projectStatus,
  syncIndex,
  type DocFilterOptions,
  type LoadedConfig,
  type ParsedDoc,
  type ProjectStatus,
} from "./core/index.js";

const USAGE = `Usage: marian-knows <command> [options]

Commands:
  init <project_name>   Create a minimal marian-knows.yml (never overwrites)
  scan                  Scan the source directory and print virtual paths (dry run, no index)
  parse <file>          Parse a Markdown file given by disk path (diagnostic, no config needed)
  index [--full]        Sync the index (.marian-knows/index.db next to the config)
  search <query>        Search the index, one virtual path per line (exit 1: no results)
  list                  List indexed files sorted by path (exit 1: no files)
  get <path>            Print an indexed file by virtual path
  status                Show project, config and index state
  destroy               Remove the index (.marian-knows/); the config stays
  help                  Show this help

Options:
  --config <file>          Path to marian-knows.yml (for init: the file to create)
  --json                   JSON output (scan, parse, search, list, status)
  --disk                   Include disk paths (scan; diagnostic only)
  --full                   Rebuild the index from scratch (index)
  -n <limit>               Max number of files (search; default 10)
  --exact                  No word trimming, no prefix match, no OR fallback (search)
  --tag <tag>              Only files with this tag (search, list)
  --path <prefix>          Only this subtree ('/dir/') or file ('/a.md'); repeatable (search, list)
  --exclude-path <prefix>  Leave out a subtree or file; repeatable (search, list)
  --snippets               Print a snippet under each path, matches in [...] (search)
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
  help: { type: "boolean", short: "h" },
} as const;

/** Positional arguments each command takes after its name (search: any number of query words). */
const ARITY: Record<string, number> = { init: 1, scan: 0, parse: 1, index: 0, list: 0, get: 1, status: 0, destroy: 0 };

const warn = (warnings: string[]) => {
  for (const w of warnings) console.error(`! warning: ${w}`);
};

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
    limit = /^\d+$/.test(values.limit) ? Number(values.limit) : NaN;
    if (!(limit >= 1)) {
      console.error(`error: -n expects a positive integer, got '${values.limit}'`);
      return 2;
    }
  }
  const config = requireConfig(values.config);
  if (!config) return 2;
  const { hits, warnings } = searchIndex(config, query, {
    ...filterOptions(values),
    limit,
    exact: values.exact,
    snippets: values.snippets,
  });
  warn(warnings);
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
  const { docs, warnings } = listIndex(config, filterOptions(values));
  warn(warnings);
  if (values.json) console.log(JSON.stringify(docs));
  else for (const d of docs) console.log(d.path);
  return docs.length ? 0 : 1;
}

function get(virtualPath: string | undefined, values: { config?: string }): number {
  if (virtualPath === undefined) {
    console.error("error: missing <path>. Usage: marian-knows get <path>");
    return 2;
  }
  const config = requireConfig(values.config);
  if (!config) return 2;
  process.stdout.write(getDoc(config, virtualPath).content);
  return 0;
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
  console.log(destroyIndex(config) ? "Removed the index (.marian-knows/)" : "No index to remove");
  return 0;
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
    // IndexLockedError, InvalidPathError, DocNotFoundError and anything unexpected: exit 2, never 1
    // (that means "no results").
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
