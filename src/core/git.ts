import { execFile, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { GitError } from "./errors.js";
import type { GitSource } from "./types.js";

export interface GitSyncResult {
  action: "cloned" | "updated" | "unchanged" | "skipped";
  /** `<short sha> <ISO commit date>` of the checked out commit; null when it cannot be read. */
  commit: string | null;
  warnings: string[];
}

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Hides credentials in http(s) URLs: `https://user:secret@host` -> `https://***@host`. */
export function redactUrl(text: string): string {
  return text.replace(/(https?:\/\/)[^/@\s]+@/g, "$1***@");
}

const ADD_KEY = "add this key to the repository as a read-only deploy key";

/** Environment for git: never prompt for a password; with a deploy key, ssh uses only that key and its own known_hosts. */
export function gitEnv(git: GitSource): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (git.deployKey) {
    // git runs GIT_SSH_COMMAND through a shell.
    const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
    env.GIT_SSH_COMMAND =
      `ssh -i ${q(git.deployKey)} -o IdentitiesOnly=yes -o UserKnownHostsFile=${q(`${git.deployKey}.known_hosts`)} ` +
      "-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15";
  }
  return env;
}

function publicKey(deployKey: string): string | null {
  try {
    return readFileSync(`${deployKey}.pub`, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Turns git's stderr into one actionable message: ssh's host key banner shrinks to a line, auth failures name the key. */
export function explainGitFailure(stderr: string, git: GitSource): string {
  if (stderr.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")) {
    const file = git.deployKey ? `${git.deployKey}.known_hosts` : "the host from ~/.ssh/known_hosts";
    return `the git host key has changed; if expected, delete ${file}`;
  }
  const message = redactUrl(stderr.trim() || "unknown git error");
  if (git.deployKey && stderr.includes("Permission denied (publickey)")) {
    const pub = publicKey(git.deployKey);
    if (pub) return `${message}\n${ADD_KEY}:\n${pub}`;
  }
  return message;
}

/** Creates a missing deploy key and stops: nothing can be cloned until the key is added to the repo. */
function prepareDeployKey(key: string): void {
  if (!existsSync(key)) {
    mkdirSync(path.dirname(key), { recursive: true });
    try {
      execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "marian-knows", "-f", key], { stdio: "ignore" });
    } catch (e) {
      throw new GitError(`cannot create the deploy key ${key}: ${(e as Error).message}`);
    }
    chmodSync(key, 0o600);
    throw new GitError(`created the deploy key ${key}\n${publicKey(key) ?? ""}\n${ADD_KEY}, then run index again`);
  }
  // ssh refuses a private key readable by others.
  if (statSync(key).mode & 0o077) chmodSync(key, 0o600);
}

function run(git: GitSource, args: string[], cwd?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: gitEnv(git), maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new GitError("git not found; install git or remove the git block"));
        return;
      }
      resolve({ ok: !err, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}


const why = (r: RunResult, git: GitSource) => explainGitFailure(r.stderr || r.stdout, git);

async function describeHead(git: GitSource): Promise<string | null> {
  const r = await run(git, ["log", "-1", "--format=%h %cI"], git.repoDir);
  return r.ok && r.stdout ? r.stdout : null;
}

async function clone(git: GitSource, log: (line: string) => void): Promise<void> {
  const url = redactUrl(git.url);
  log(`git: cloning ${url} (${git.branch})`);
  // Cloned next to the target and renamed when complete: an interrupted clone never leaves a half-made `path`.
  const parent = path.dirname(git.repoDir);
  const prefix = `${path.basename(git.repoDir)}.clone-`;
  const tmp = path.join(parent, `${prefix}${process.pid}`);
  mkdirSync(parent, { recursive: true });
  // Leftovers of killed runs; their pids are gone.
  for (const name of readdirSync(parent)) {
    if (name.startsWith(prefix)) rmSync(path.join(parent, name), { recursive: true, force: true });
  }
  try {
    const args = ["clone", "-q", "--depth", "1", "--filter=blob:none", "--single-branch", "--branch", git.branch];
    if (git.path) args.push("--sparse");
    const cloned = await run(git, [...args, "--", git.url, tmp]);
    if (!cloned.ok) throw new GitError(`cannot clone ${url} (${git.branch}): ${why(cloned, git)}`);
    if (git.path) {
      const sparse = await run(git, ["sparse-checkout", "set", "--cone", git.path], tmp);
      if (!sparse.ok) throw new GitError(`cannot check out ${git.path} from ${url}: ${why(sparse, git)}`);
    }
    try {
      renameSync(tmp, git.repoDir);
    } catch (e) {
      throw new GitError(`cannot move the clone to ${git.repoDir}: ${(e as Error).message}`);
    }
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

/** `…/kb.git/` and `…/kb` name the same repo. */
const normalizeRemote = (url: string) => url.trim().replace(/\/+$/, "").replace(/\.git$/, "");

/** Throws unless `repoDir` is the top of a clone of `git.url`: MarianKnows never writes into a directory it did not clone. */
async function checkClone(git: GitSource): Promise<void> {
  const top = await run(git, ["rev-parse", "--show-toplevel"], git.repoDir);
  if (!top.ok || realpathSync(top.stdout) !== realpathSync(git.repoDir)) {
    // git's own refusal (e.g. "dubious ownership") explains more than "not a repository".
    const detail = !top.ok && !top.stderr.includes("not a git repository") ? `: ${why(top, git)}` : "";
    throw new GitError(`path exists and is not a git repository: ${git.repoDir}${detail}`);
  }
  const origin = await run(git, ["config", "--get", "remote.origin.url"], git.repoDir);
  if (normalizeRemote(origin.stdout) !== normalizeRemote(git.url)) {
    const was = origin.stdout ? redactUrl(origin.stdout) : "no origin";
    throw new GitError(
      `${git.repoDir} is a clone of ${was}, config says ${redactUrl(git.url)}; remove the directory to re-clone`,
    );
  }
}

/** Fast-forwards a clean working copy on the configured branch. Anything else is a warning, never a lost change. */
async function update(git: GitSource, warnings: string[]): Promise<GitSyncResult["action"]> {
  const dir = git.repoDir;
  const status = await run(git, ["status", "--porcelain"], dir);
  if (!status.ok) {
    warnings.push(`cannot read the state of ${dir}, not updating: ${why(status, git)}`);
    return "skipped";
  }
  if (status.stdout) {
    warnings.push(`local changes in ${dir}, not updating`);
    return "skipped";
  }
  const branch = await run(git, ["symbolic-ref", "--short", "-q", "HEAD"], dir);
  const current = branch.ok && branch.stdout ? branch.stdout : "detached HEAD";
  if (current !== git.branch) {
    warnings.push(`${dir} is on ${current}, config says ${git.branch}; not updating`);
    return "skipped";
  }

  // Sparse clones follow `git.path`, so changing it needs no re-clone. A full clone made by hand stays full.
  const sparse = await run(git, ["config", "--bool", "core.sparseCheckout"], dir);
  if (sparse.stdout === "true") {
    const r = await run(git, git.path ? ["sparse-checkout", "set", "--cone", git.path] : ["sparse-checkout", "disable"], dir);
    if (!r.ok) warnings.push(`cannot check out ${git.path || "the whole repository"}: ${why(r, git)}`);
  }

  const fetched = await run(git, ["fetch", "-q", "origin", git.branch], dir);
  if (!fetched.ok) {
    warnings.push(`fetch failed, indexing the previous content: ${why(fetched, git)}`);
    return "skipped";
  }
  const head = await run(git, ["rev-parse", "HEAD"], dir);
  const target = await run(git, ["rev-parse", "FETCH_HEAD"], dir);
  if (head.ok && head.stdout === target.stdout) return "unchanged";
  const merged = await run(git, ["merge", "-q", "--ff-only", "FETCH_HEAD"], dir);
  if (!merged.ok) {
    warnings.push(`cannot fast-forward ${dir}; indexing the local content`);
    return "skipped";
  }
  return "updated";
}

/**
 * Brings the working copy at `git.repoDir` up to date: clones it when missing, otherwise fast-forwards it.
 * Problems with an existing clone are warnings (the previous content stays indexable); a failed clone or a `path` that
 * is not this repo's clone throws GitError.
 */
export async function syncGitSource(git: GitSource, log: (line: string) => void): Promise<GitSyncResult> {
  if (git.deployKey) prepareDeployKey(git.deployKey);
  const warnings: string[] = [];
  let action: GitSyncResult["action"];
  // An empty directory (e.g. made by hand, or a mount point) is as good as a missing one, like for `git clone`.
  if (existsSync(git.repoDir) && statSync(git.repoDir).isDirectory() && readdirSync(git.repoDir).length === 0) {
    rmSync(git.repoDir, { recursive: true });
  }
  if (!existsSync(git.repoDir)) {
    await clone(git, log);
    action = "cloned";
  } else {
    await checkClone(git);
    action = await update(git, warnings);
  }

  if (git.path && !existsSync(path.join(git.repoDir, git.path))) {
    warnings.push(`git.path not found in the repository: ${git.path}`);
  }
  const commit = await describeHead(git);
  log(`git: ${redactUrl(git.url)} (${git.branch}) at ${commit ?? "unknown commit"}`);
  return { action, commit, warnings };
}
