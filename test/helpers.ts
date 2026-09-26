import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll } from "vitest";

const dirs: string[] = [];

// afterAll, not afterEach: concurrent tests would lose their dirs mid-run.
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Creates a temp dir with the given files ("a/b.md" -> content).
 * Returns the real path (macOS: /var -> /private/var), matching what a subprocess sees as cwd.
 */
export function makeTree(files: Record<string, string> = {}): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "marian-knows-")));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
// Resolved from the repo, not from the subprocess cwd (a temp dir without node_modules).
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the CLI from source in a subprocess, with MARIAN_KNOWS_CONFIG removed from the env. */
export function runCli(args: string[], opts: { cwd: string }): Promise<CliResult> {
  const env = { ...process.env };
  delete env.MARIAN_KNOWS_CONFIG;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", TSX, CLI, ...args], { cwd: opts.cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
