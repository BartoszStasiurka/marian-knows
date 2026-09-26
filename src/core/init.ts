import { writeFileSync } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { validateProjectName } from "./config.js";
import { ConfigError } from "./errors.js";

/**
 * Creates a minimal config containing only `name`. Never overwrites an existing file.
 * Touches nothing else: no .gitignore, no database files.
 */
export function initConfig(targetPath: string, name: string): string {
  const problems = validateProjectName(name);
  if (problems.length) throw new ConfigError(problems.map((p) => `name: ${p}`));

  const abs = path.resolve(targetPath);
  try {
    writeFileSync(abs, stringify({ name: name.trim() }), { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ConfigError([`config already exists: ${abs}`]);
    }
    throw new ConfigError([`cannot create config file: ${(e as Error).message}`]);
  }
  return abs;
}
