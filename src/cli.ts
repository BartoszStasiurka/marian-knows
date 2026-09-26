#!/usr/bin/env node
import { parseArgs } from "node:util";
import { CONFIG_FILENAME, ConfigError, findConfig, initConfig, loadConfig, scanSource } from "./core/index.js";

const USAGE = `Usage: marian-knows <command> [options]

Commands:
  init <project_name>   Create a minimal marian-knows.yml (never overwrites)
  scan                  Scan the source directory and print virtual paths (dry run, no index)

Options:
  --config <file>   Path to marian-knows.yml (for init: the file to create)
  --json            JSON output (scan)
  --disk            Include disk paths (scan; diagnostic only)
  -h, --help        Show this help`;

async function scan(values: { config?: string; json?: boolean; disk?: boolean }): Promise<number> {
  const configPath = findConfig({ explicit: values.config });
  if (!configPath) {
    console.error("Config not found. Use --config, MARIAN_KNOWS_CONFIG or run: marian-knows init <project_name>");
    return 2;
  }
  const config = loadConfig(configPath);
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
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: "string" },
        json: { type: "boolean" },
        disk: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }

  const { values, positionals } = parsed;
  const [command, ...args] = positionals;

  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 2;
  }

  try {
    switch (command) {
      case "scan":
        return await scan(values);
      case "init":
        return init(args[0], values);
      default:
        console.error(`Unknown command: ${command}\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof ConfigError) {
      for (const err of e.errors) console.error(`error: ${err}`);
      return 2;
    }
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
