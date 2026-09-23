import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ConfigError } from "./errors.js";
import type { LoadedConfig, Mount } from "./types.js";
import { validateVirtualPath } from "./virtual-path.js";

export const CONFIG_FILENAME = "marian-knows.yml";
export const CONFIG_ENV = "MARIAN_KNOWS_CONFIG";

const SourceSchema = z
  .object({
    path: z.string().min(1),
    recursive: z.boolean().default(true),
    exclude: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict();

const ConfigSchema = z
  .object({
    sources: z
      .record(z.string(), SourceSchema)
      .refine((s) => Object.keys(s).length > 0, "must contain at least one source"),
  })
  .strict();

function formatIssue(issue: z.ZodIssue): string {
  const where = issue.path.length ? issue.path.map(String).join(" > ") : "(root)";
  return `${where}: ${issue.message}`;
}

/** Config lookup order: --config, env, then marian-knows.yml walking up from cwd. */
export function findConfig(opts: {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): string | undefined {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;

  const given = opts.explicit ?? env[CONFIG_ENV];
  if (given) return path.resolve(cwd, given);

  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function loadConfig(configPath: string): LoadedConfig {
  const absConfig = path.resolve(configPath);
  const configDir = path.dirname(absConfig);

  let raw: string;
  try {
    raw = readFileSync(absConfig, "utf8");
  } catch {
    throw new ConfigError([`cannot read config file: ${absConfig}`]);
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (e) {
    throw new ConfigError([`invalid YAML: ${(e as Error).message}`]);
  }

  const parsed = ConfigSchema.safeParse(data);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map(formatIssue));

  const errors: string[] = [];
  const seenLower = new Map<string, string>();
  const mounts: Mount[] = [];

  for (const [key, src] of Object.entries(parsed.data.sources)) {
    const label = `source "${key}"`;

    for (const problem of validateVirtualPath(key)) errors.push(`${label}: ${problem}`);

    const lower = key.toLowerCase();
    const clash = seenLower.get(lower);
    if (clash !== undefined) {
      errors.push(`${label}: conflicts with "${clash}" (keys are unique ignoring case)`);
    } else {
      seenLower.set(lower, key);
    }

    const kind = key.endsWith("/") ? "dir" : "file";
    const diskPath = path.resolve(configDir, src.path);

    if (kind === "file" && !diskPath.toLowerCase().endsWith(".md")) {
      errors.push(`${label}: a file source must point to a .md file`);
    }

    let exists = false;
    try {
      const st = statSync(diskPath);
      exists = true;
      if (kind === "dir" && !st.isDirectory()) {
        errors.push(`${label}: key ends with '/' but path is not a directory`);
      }
      if (kind === "file" && !st.isFile()) {
        errors.push(`${label}: key does not end with '/' but path is not a file`);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        errors.push(`${label}: cannot access path (${(e as Error).message})`);
      }
    }

    mounts.push({
      key,
      kind,
      diskPath,
      exists,
      recursive: src.recursive,
      exclude:
        src.exclude === undefined
          ? []
          : typeof src.exclude === "string"
            ? [src.exclude]
            : src.exclude,
    });
  }

  if (errors.length) throw new ConfigError(errors);
  return { configPath: absConfig, configDir, mounts };
}
