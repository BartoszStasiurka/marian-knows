#!/usr/bin/env node
import { parseArgs } from "node:util";
import { ConfigError, findConfig, loadConfig, scanSource } from "./core/index.js";

const USAGE = `Usage: marian-knows <command> [options]

Commands:
  scan    Scan the source directory and print virtual paths (dry run, no index)

Options:
  --config <file>   Path to marian-knows.yml
  --json            JSON output (scan)
  --disk            Include disk paths (scan; diagnostic only)
  -h, --help        Show this help`;

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
  const [command] = positionals;

  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 2;
  }
  if (command !== "scan") {
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    return 2;
  }

  try {
    const configPath = findConfig({ explicit: values.config });
    if (!configPath) {
      console.error("Config not found. Use --config, MARIAN_KNOWS_CONFIG or create marian-knows.yml");
      return 2;
    }
    const config = loadConfig(configPath);
    const { files, warnings } = await scanSource(config);

    for (const w of warnings) console.error(`! warning: ${w}`);

    if (values.json) {
      console.log(
        JSON.stringify(
          files.map((f) => (values.disk ? { path: f.virtualPath, disk: f.diskPath } : { path: f.virtualPath })),
        ),
      );
    } else {
      for (const f of files) console.log(values.disk ? `${f.virtualPath}\t${f.diskPath}` : f.virtualPath);
    }
    console.error(`Files: ${files.length}`);
    return 0;
  } catch (e) {
    if (e instanceof ConfigError) {
      for (const err of e.errors) console.error(`error: ${err}`);
      return 2;
    }
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
