import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GitError, redactUrl, syncGitSource, type GitSource } from "../src/core/index.js";
import { explainGitFailure, gitEnv } from "../src/core/git.js";
import { git as gitCmd, makeOrigin, makeTree } from "./helpers.js";

function source(url: string, over: Partial<GitSource> = {}): GitSource {
  return { url, branch: "main", path: "", repoDir: path.join(makeTree(), "kb"), deployKey: null, ...over };
}

const quiet = () => {};

describe("syncGitSource clone", () => {
  it("clones into path", async () => {
    const origin = makeOrigin({ "docs/a.md": "# A", "README.md": "x" });
    const git = source(origin.url);
    const lines: string[] = [];
    const r = await syncGitSource(git, (l) => lines.push(l));
    expect(r.action).toBe("cloned");
    expect(r.commit).toMatch(/^[0-9a-f]{7,} \d{4}-/);
    expect(r.warnings).toEqual([]);
    expect(existsSync(path.join(git.repoDir, "docs/a.md"))).toBe(true);
    expect(existsSync(path.join(git.repoDir, "README.md"))).toBe(true);
    expect(lines[0]).toBe(`git: cloning ${origin.url} (main)`);
    expect(lines.at(-1)).toBe(`git: ${origin.url} (main) at ${r.commit}`);
  });

  it("sparse clone checks out only git.path", async () => {
    const origin = makeOrigin({ "docs/a.md": "# A", "src/b.md": "# B" });
    const git = source(origin.url, { path: "docs" });
    await syncGitSource(git, quiet);
    expect(existsSync(path.join(git.repoDir, "docs/a.md"))).toBe(true);
    expect(existsSync(path.join(git.repoDir, "src/b.md"))).toBe(false);
  });

  it("warns when git.path is missing in the repo", async () => {
    const origin = makeOrigin({ "docs/a.md": "# A" });
    const r = await syncGitSource(source(origin.url, { path: "nope" }), quiet);
    expect(r.warnings).toContain("git.path not found in the repository: nope");
  });

  it("failed clone leaves nothing behind", async () => {
    const origin = makeOrigin({ "a.md": "# A" });
    const git = source(origin.url, { branch: "missing" });
    await expect(syncGitSource(git, quiet)).rejects.toBeInstanceOf(GitError);
    expect(existsSync(git.repoDir)).toBe(false);
    expect(readdirSync(path.dirname(git.repoDir))).toEqual([]);
  });

  it("clones into an existing empty directory", async () => {
    const origin = makeOrigin({ "a.md": "# A" });
    const git = source(origin.url);
    mkdirSync(git.repoDir);
    expect((await syncGitSource(git, quiet)).action).toBe("cloned");
    expect(existsSync(path.join(git.repoDir, "a.md"))).toBe(true);
  });

  it("removes clone leftovers of killed runs", async () => {
    const origin = makeOrigin({ "a.md": "# A" });
    const git = source(origin.url);
    mkdirSync(`${git.repoDir}.clone-99999`);
    await syncGitSource(git, quiet);
    expect(readdirSync(path.dirname(git.repoDir))).toEqual(["kb"]);
  });

  it("uses cone mode whatever the user's git config says", async () => {
    const origin = makeOrigin({ "docs/a.md": "# A", "src/docs/b.md": "# B" });
    const git = source(origin.url, { path: "docs" });
    const before = process.env.GIT_CONFIG_PARAMETERS;
    process.env.GIT_CONFIG_PARAMETERS = "'core.sparsecheckoutcone'='false'";
    try {
      await syncGitSource(git, quiet);
    } finally {
      if (before === undefined) delete process.env.GIT_CONFIG_PARAMETERS;
      else process.env.GIT_CONFIG_PARAMETERS = before;
    }
    expect(existsSync(path.join(git.repoDir, "docs/a.md"))).toBe(true);
    expect(existsSync(path.join(git.repoDir, "src/docs/b.md"))).toBe(false);
  });

  it("redactUrl hides userinfo", () => {
    expect(redactUrl("https://u:s@h/x.git")).toBe("https://***@h/x.git");
    expect(redactUrl("see https://tok@h/x and more")).toBe("see https://***@h/x and more");
    expect(redactUrl("git@h:t/x.git")).toBe("git@h:t/x.git");
    expect(redactUrl("ssh://git@h/t/x.git")).toBe("ssh://git@h/t/x.git");
  });

  it("gitEnv disables prompts and keeps the ssh command without deployKey", () => {
    const env = gitEnv(source("u"));
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_SSH_COMMAND).toBe(process.env.GIT_SSH_COMMAND);
  });
});

describe("syncGitSource update", () => {
  async function cloned(files: Record<string, string> = { "docs/a.md": "# A" }, over: Partial<GitSource> = {}) {
    const origin = makeOrigin(files);
    const git = source(origin.url, over);
    await syncGitSource(git, quiet);
    return { origin, git };
  }

  it("fast-forwards to a new commit", async () => {
    const { origin, git } = await cloned();
    origin.commit({ "docs/b.md": "# B" });
    const r = await syncGitSource(git, quiet);
    expect(r).toMatchObject({ action: "updated", warnings: [] });
    expect(existsSync(path.join(git.repoDir, "docs/b.md"))).toBe(true);
  });

  it("reports unchanged when origin did not move", async () => {
    const { git } = await cloned();
    expect(await syncGitSource(git, quiet)).toMatchObject({ action: "unchanged", warnings: [] });
  });

  it("keeps local changes", async () => {
    const { origin, git } = await cloned();
    writeFileSync(path.join(git.repoDir, "docs/a.md"), "# local");
    origin.commit({ "docs/b.md": "# B" });
    const r = await syncGitSource(git, quiet);
    expect(r.action).toBe("skipped");
    expect(r.warnings).toEqual([`local changes in ${git.repoDir}, not updating`]);
    expect(readFileSync(path.join(git.repoDir, "docs/a.md"), "utf8")).toBe("# local");
    expect(existsSync(path.join(git.repoDir, "docs/b.md"))).toBe(false);
  });

  it("skips another branch", async () => {
    const { git } = await cloned();
    gitCmd(git.repoDir, "checkout", "-q", "-b", "feature");
    const r = await syncGitSource(git, quiet);
    expect(r.action).toBe("skipped");
    expect(r.warnings).toEqual([`${git.repoDir} is on feature, config says main; not updating`]);
  });

  it("skips detached HEAD", async () => {
    const { git } = await cloned();
    gitCmd(git.repoDir, "checkout", "-q", "--detach");
    const r = await syncGitSource(git, quiet);
    expect(r.action).toBe("skipped");
    expect(r.warnings[0]).toContain("is on detached HEAD");
  });

  it("warns on diverged history", async () => {
    const { origin, git } = await cloned();
    writeFileSync(path.join(git.repoDir, "docs/local.md"), "# L");
    gitCmd(git.repoDir, "add", "-A");
    gitCmd(git.repoDir, "commit", "-q", "-m", "local");
    origin.commit({ "docs/b.md": "# B" });
    const r = await syncGitSource(git, quiet);
    expect(r.action).toBe("skipped");
    expect(r.warnings[0]).toContain(`cannot fast-forward ${git.repoDir}; indexing the local content`);
    expect(existsSync(path.join(git.repoDir, "docs/local.md"))).toBe(true);
  });

  it("fetch failure keeps the content", async () => {
    const { origin, git } = await cloned();
    rmSync(origin.dir, { recursive: true, force: true });
    const r = await syncGitSource(git, quiet);
    expect(r.action).toBe("skipped");
    expect(r.warnings[0]).toContain("fetch failed, indexing the previous content");
    expect(existsSync(path.join(git.repoDir, "docs/a.md"))).toBe(true);
  });

  it("sparse set follows git.path", async () => {
    const { git } = await cloned({ "docs/a.md": "# A", "src/b.md": "# B" }, { path: "docs" });
    expect(existsSync(path.join(git.repoDir, "src/b.md"))).toBe(false);
    await syncGitSource({ ...git, path: "src" }, quiet);
    expect(existsSync(path.join(git.repoDir, "src/b.md"))).toBe(true);
  });

  it("updates a hand-made full clone without making it sparse", async () => {
    const origin = makeOrigin({ "docs/a.md": "# A", "src/b.md": "# B" });
    const git = source(origin.url, { path: "docs" });
    gitCmd(path.dirname(git.repoDir), "clone", "-q", origin.url, git.repoDir);
    origin.commit({ "docs/c.md": "# C" });
    const r = await syncGitSource(git, quiet);
    expect(r).toMatchObject({ action: "updated", warnings: [] });
    expect(existsSync(path.join(git.repoDir, "docs/c.md"))).toBe(true);
    expect(existsSync(path.join(git.repoDir, "src/b.md"))).toBe(true);
  });

  it("matches origin ignoring trailing .git and slash", async () => {
    const origin = makeOrigin({ "a.md": "# A" }, { name: "kb.git" });
    const git = source(origin.url);
    await syncGitSource(git, quiet);
    const bare = origin.url.replace(/\.git$/, "");
    expect((await syncGitSource({ ...git, url: `${bare}/` }, quiet)).action).toBe("unchanged");
    expect((await syncGitSource({ ...git, url: bare }, quiet)).action).toBe("unchanged");
  });

  it("refuses a plain directory", async () => {
    const git = source("file:///nowhere");
    mkdirSync(git.repoDir);
    writeFileSync(path.join(git.repoDir, "x.md"), "x");
    await expect(syncGitSource(git, quiet)).rejects.toThrow(`path exists and is not a git repository: ${git.repoDir}`);
  });

  it("refuses a directory inside another repo", async () => {
    const { git: outer } = await cloned();
    const git = source(outer.url, { repoDir: path.join(outer.repoDir, "docs") });
    await expect(syncGitSource(git, quiet)).rejects.toThrow("path exists and is not a git repository");
  });

  it("refuses a clone of another repo", async () => {
    const { git } = await cloned();
    const other = makeOrigin({ "b.md": "# B" });
    const err = await syncGitSource({ ...git, url: other.url }, quiet).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message).toContain(`is a clone of ${git.url}`);
    expect((err as Error).message).toContain("remove the directory to re-clone");
  });
});

const hasSshKeygen = (() => {
  try {
    execFileSync("ssh-keygen", ["-?"], { stdio: "ignore" });
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ENOENT";
  }
})();

describe("deploy key", () => {
  it("gitEnv sets the ssh command with a deploy key", () => {
    expect(gitEnv(source("u", { deployKey: "/k/key" })).GIT_SSH_COMMAND).toBe(
      "ssh -i '/k/key' -o IdentitiesOnly=yes -o UserKnownHostsFile='/k/key.known_hosts' " +
        "-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15",
    );
  });

  it("gitEnv quotes key paths for the shell", () => {
    const cmd = gitEnv(source("u", { deployKey: `/k/it's "$x"` })).GIT_SSH_COMMAND;
    expect(cmd).toContain(`-i '/k/it'\\''s "$x"'`);
  });

  it.skipIf(!hasSshKeygen)("generates a missing key and stops", async () => {
    const key = path.join(makeTree(), "deploy_key");
    const git = source("git@example.invalid:t/kb.git", { deployKey: key });
    const err = await syncGitSource(git, quiet).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message).toContain("ssh-ed25519 ");
    expect((err as Error).message).toContain("add this key to the repository as a read-only deploy key");
    expect(statSync(key).mode & 0o777).toBe(0o600);
    expect(existsSync(git.repoDir)).toBe(false);
  });

  it("tightens key permissions", async () => {
    const origin = makeOrigin({ "a.md": "# A" });
    const key = path.join(makeTree(), "deploy_key");
    writeFileSync(key, "not really a key");
    chmodSync(key, 0o644);
    await syncGitSource(source(origin.url, { deployKey: key }), quiet);
    expect(statSync(key).mode & 0o777).toBe(0o600);
  });

  it("explains a changed host key", () => {
    const stderr = "@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@\nmore banner";
    expect(explainGitFailure(stderr, source("u", { deployKey: "/k/key" }))).toBe(
      "the git host key has changed; if expected, delete /k/key.known_hosts",
    );
  });

  it("repeats the public key on auth failure", () => {
    const dir = makeTree({ "key.pub": "ssh-ed25519 AAAA test\n" });
    const msg = explainGitFailure(
      "git@h: Permission denied (publickey).\nfatal: Could not read from remote repository.",
      source("u", { deployKey: path.join(dir, "key") }),
    );
    expect(msg).toContain("Permission denied (publickey)");
    expect(msg).toContain("ssh-ed25519 AAAA test");
  });

  it("passes other errors through redacted", () => {
    expect(explainGitFailure("fatal: repository 'https://u:s@h/x' not found", source("u"))).toBe(
      "fatal: repository 'https://***@h/x' not found",
    );
  });
});
