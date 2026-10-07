import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ConfigError } from "./errors.js";
import type { LoadedConfig } from "./types.js";
import { CONTROL_CHARS } from "./virtual-path.js";

export const CONFIG_FILENAME = "marian-knows.yml";
export const CONFIG_ENV = "MARIAN_KNOWS_CONFIG";
export const MAX_NAME_LENGTH = 128;
export const MAX_DESCRIPTION_LENGTH = 2000;

const ConfigSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    path: z.string().min(1).optional(),
    exclude: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict();

function formatIssue(issue: z.ZodIssue): string {
  const where = issue.path.length ? issue.path.map(String).join(" > ") : "(root)";
  return `${where}: ${issue.message}`;
}

/** Validates a project name after trimming. Returns a list of problems; empty list means valid. */
export function validateProjectName(raw: string): string[] {
  const name = raw.trim();
  const errors: string[] = [];
  if (name.length === 0) errors.push("must not be empty");
  if (name.length > MAX_NAME_LENGTH) errors.push(`longer than ${MAX_NAME_LENGTH} characters`);
  if (CONTROL_CHARS.test(name)) errors.push("must not contain control characters");
  return errors;
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

  if (data !== null && typeof data === "object" && "sources" in data) {
    throw new ConfigError(["sources: no longer supported; use name, path and exclude"]);
  }

  const parsed = ConfigSchema.safeParse(data);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map(formatIssue));

  const errors: string[] = [];
  for (const problem of validateProjectName(parsed.data.name)) errors.push(`name: ${problem}`);
  const description = parsed.data.description?.trim();
  if (description === "") errors.push("description: must not be empty");
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description: longer than ${MAX_DESCRIPTION_LENGTH} characters`);
  }

  const sourceDir = path.resolve(configDir, parsed.data.path ?? ".");
  let sourceExists = false;
  try {
    const st = statSync(sourceDir);
    sourceExists = true;
    if (!st.isDirectory()) errors.push(`path: not a directory: ${sourceDir}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      errors.push(`path: cannot access directory (${(e as Error).message})`);
    }
  }

  if (errors.length) throw new ConfigError(errors);

  const { exclude } = parsed.data;
  return {
    configPath: absConfig,
    configDir,
    name: parsed.data.name.trim(),
    description: description ?? null,
    sourceDir,
    sourceExists,
    exclude: exclude === undefined ? [] : typeof exclude === "string" ? [exclude] : exclude,
  };
}
