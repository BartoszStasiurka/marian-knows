#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  CONFIG_FILENAME,
  ConfigError,
  IndexLockedError,
  IndexMissingError,
  findConfig,
  initConfig,
  loadConfig,
  parseFile,
  scanSource,
  search as searchIndex,
  syncIndex,
  type LoadedConfig,
  type ParsedDoc,
} from "./core/index.js";

const USAGE = `Usage: marian-knows <command> [options]

Commands:
  init <project_name>   Create a minimal marian-knows.yml (never overwrites)
  scan                  Scan the source directory and print virtual paths (dry run, no index)
  parse <file>          Parse a Markdown file given by disk path (diagnostic, no config needed)
  index [--full]        Sync the index (.marian-knows/index.db next to the config)
  search <query>        Search the index, one virtual path per line (exit 1: no results)
  help                  Show this help

Not implemented yet:
  list                  List indexed files
  get <path>            Print a file by virtual path
  status                Show project, config and index state
  destroy               Remove the project and all its data

Options:
  --config <file>   Path to marian-knows.yml (for init: the file to create)
  --json            JSON output (scan, parse)
  --disk            Include disk paths (scan; diagnostic only)
  --full            Rebuild the index from scratch (index)
  -n <limit>        Max number of files (search; default 10)
  --exact           No word trimming, no prefix match, no OR fallback (search)
  --tag <tag>       Only files with this tag (search)
  --snippets        Print a snippet under each path, matches in [...] (search)
  -h, --help        Show this help`;

const OPTIONS = {
  config: { type: "string" },
  json: { type: "boolean" },
  disk: { type: "boolean" },
  full: { type: "boolean" },
  limit: { type: "string", short: "n" },
  exact: { type: "boolean" },
  tag: { type: "string" },
  snippets: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

/** Recognised but not implemented: no side effects, exit 0. */
const STUBS = new Set(["list", "get", "status", "destroy"]);

/** Finds and loads the config; prints an error and returns null when there is none. */
function requireConfig(explicit: string | undefined): LoadedConfig | null {
  const configPath = findConfig({ explicit });
  if (!configPath) {
    console.error("Config not found. Use --config, MARIAN_KNOWS_CONFIG or run: marian-knows init <project_name>");
    return null;
  }
  return loadConfig(configPath);
}

async function scan(values: { config?: string; json?: boolean; disk?: boolean }): Promise<number> {
  const config = requireConfig(values.config);
  if (!config) return 2;
  const { files, warnings } = await scanSource(config);

  for (const w of warnings) console.error(`! warning: ${w}`);

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
  console.log(`Plików .md: ${r.files}`);
  console.log(`+ ${r.added} nowych, ~ ${r.changed} zmienionych, - ${r.removed} usuniętych (${seconds} s)`);
  for (const w of r.warnings) console.error(`! warning: ${w}`);
  return 0;
}

async function search(
  words: string[],
  values: { config?: string; limit?: string; exact?: boolean; tag?: string; snippets?: boolean },
): Promise<number> {
  const query = words.join(" ");
  if (!query.trim()) {
    console.error("Missing <query>. Usage: marian-knows search <query> [options]");
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
  const hits = searchIndex(config, query, { limit, exact: values.exact, tag: values.tag, snippets: values.snippets });
  for (const h of hits) {
    console.log(h.path);
    if (h.snippet) console.log(`  ${h.snippet}`);
  }
  return hits.length ? 0 : 1;
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
    console.error("Missing <file>. Usage: marian-knows parse <file> [--json]");
    return 2;
  }
  let doc: ParsedDoc;
  try {
    doc = parseFile(file);
  } catch (e) {
    console.error(`error: cannot read ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    return 2;
  }
  for (const w of doc.warnings) console.error(`! warning: ${w}`);
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
    console.error("Missing <project_name>. Usage: marian-knows init <project_name>");
    return 2;
  }
  const written = initConfig(values.config ?? CONFIG_FILENAME, name);
  console.log(`Created ${written}`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  // Stubs accept any options (e.g. `search -n 5`), so detect them before strict parsing.
  const [loose] = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false }).positionals;
  // The search --json contract comes with stage 6; until then it does not pretend to have one.
  const jsonSearch = loose === "search" && argv.includes("--json");
  if (loose !== undefined && (STUBS.has(loose) || jsonSearch)) {
    console.error("TODO: implementacja");
    return 0;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
    });
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }

  const { values, positionals } = parsed;
  const [command, ...args] = positionals;

  if (values.help || command === "help" || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 2;
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
      default:
        console.error(`Unknown command: ${command}\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof ConfigError) {
      for (const err of e.errors) console.error(`error: ${err}`);
      return 2;
    }
    if (e instanceof IndexLockedError) {
      console.error(`error: ${e.message}`);
      return 2;
    }
    if (e instanceof IndexMissingError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
