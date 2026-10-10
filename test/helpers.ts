import { execFileSync, spawn } from "node:child_process";
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

export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
// Resolved from the repo, not from the subprocess cwd (a temp dir without node_modules).
export const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI from source in a subprocess, with MARIAN_KNOWS_CONFIG removed from the env.
 * The query log is off unless `log` is set.
 */
export function runCli(args: string[], opts: { cwd: string; log?: boolean }): Promise<CliResult> {
  const env = { ...process.env };
  delete env.MARIAN_KNOWS_CONFIG;
  if (opts.log) delete env.MARIAN_KNOWS_NO_LOG;
  else env.MARIAN_KNOWS_NO_LOG = "1";
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

/** Runs git synchronously with a fixed identity; returns trimmed stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export interface Origin {
  /** file:// URL of the bare repo. */
  url: string;
  dir: string;
  /** Commits the files (rel path -> content) on top of the branch and pushes; returns the sha. */
  commit(files: Record<string, string>, message?: string): string;
}

/** A bare "remote" repo in a temp dir, with one commit holding `files`. */
export function makeOrigin(files: Record<string, string>, opts: { branch?: string; name?: string } = {}): Origin {
  const branch = opts.branch ?? "main";
  const root = makeTree();
  const dir = path.join(root, opts.name ?? "origin.git");
  mkdirSync(dir);
  git(dir, "init", "-q", "--bare", "-b", branch);
  // Lets `clone --filter` work over file:// without a "filtering not recognized" warning.
  git(dir, "config", "uploadpack.allowFilter", "true");
  const work = path.join(root, "work");
  git(root, "init", "-q", "-b", branch, work);
  git(work, "remote", "add", "origin", dir);
  const commit = (more: Record<string, string>, message = "update"): string => {
    for (const [rel, content] of Object.entries(more)) {
      const full = path.join(work, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", message);
    git(work, "push", "-q", "origin", branch);
    return git(work, "rev-parse", "HEAD");
  };
  commit(files, "initial");
  return { url: pathToFileURL(dir).href, dir, commit };
}
