# Git Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `marian-knows index` clones or fast-forwards the knowledge repo described in a `git:` block of `marian-knows.yml`, so the Docker entrypoint no longer handles git.

**Architecture:** `loadConfig` parses and validates the `git` block into `LoadedConfig.git` (no git calls). New `src/core/git.ts` exposes `syncGitSource`, which runs the `git` binary via `execFile`; the `index` adapter in `src/cli.ts` calls it before `syncIndex`. The entrypoint shrinks to ownership fix, index, serve.

**Tech Stack:** Node 20 ESM, TypeScript strict, zod, vitest, `git` ≥ 2.28 and `ssh-keygen` binaries (no new npm deps).

**Spec:** `docs/superpowers/specs/2026-10-08-git-source-design.md`

## Global Constraints

- No new npm dependencies; git via `node:child_process` `execFile` (no shell).
- All logic in `src/core/`; `src/cli.ts` only wires and prints.
- Every error exits 2 (exit 1 means "no results" in this project). Config errors are `ConfigError`, git errors are `GitError`.
- `git.branch` default `main`. `git.path`: leading `/` dropped, `..`, `\`, control chars rejected, `.`/empty = repo root.
- `path` is required when `git` is set.
- Clone: `git clone --depth 1 --filter=blob:none --single-branch --branch <branch> [--sparse] <url> <tmp>`, tmp = `<path>.clone-<pid>`, renamed to `<path>` when complete.
- Update: `fetch origin <branch>` + `merge --ff-only FETCH_HEAD`; never `reset`, never `clean`.
- `GIT_TERMINAL_PROMPT=0` always. `GIT_SSH_COMMAND` only with `deployKey`, exact value from the spec.
- Userinfo in URLs redacted as `***@` in every printed line.
- Tests: no network; temp dirs only (`test/helpers.ts`). Code, comments, docs in English.
- `npm run typecheck && npm test` before each commit; commit messages imperative, one concern each, ending with the `Co-Authored-By` line from the session.

## Review Focus

1. A clone made by hand (full history, not sparse) at `path` with the same URL: expected to update normally and never get sparse settings forced on it. Test in Task 3.
2. `git.url` and the clone's origin differ only by a trailing `.git` or `/`: expected to be the same repo. Test in Task 3.
3. `git.path` typo (directory missing in the repo): expected a clear warning, not a silent "0 files". Test in Task 2.
4. Clone interrupted or failed halfway: expected no half-made `path` that confuses the next run. Test in Task 2.
5. Working copy in detached HEAD (someone checked out a tag): expected a warning and no update. Test in Task 3.

---

### Task 1: `git` block in the config

**Files:**
- Modify: `src/core/types.ts` (add `GitSource`, `LoadedConfig.git`)
- Modify: `src/core/config.ts` (schema, validation, `sourceDir`)
- Modify: `src/core/index.ts` (export `GitSource` type)
- Test: `test/config.test.ts`
- Docs: `docs/requirements.md` section 3 (config table + `git` rules), `docs/roadmap.md` (stage 15 "Git source" with the spec's bullets)

**Interfaces:**
- Produces:
  ```ts
  export interface GitSource {
    url: string;            // as written, trimmed
    branch: string;         // default "main"
    path: string;           // normalized subdirectory, "" = repo root, no leading/trailing "/"
    repoDir: string;        // absolute top-level `path` (the working copy)
    deployKey: string | null; // absolute
  }
  // LoadedConfig gains: git: GitSource | null
  // With git: sourceDir = path.join(repoDir, git.path); sourceExists as today
  ```

- [ ] **Step 1: Write failing tests** in `describe("loadConfig git", …)`:
  - `reads a git block with defaults`: `path: ./kb`, `git: {url: "git@h:t/kb.git"}` → `git` equals `{url: "git@h:t/kb.git", branch: "main", path: "", repoDir: <dir>/kb, deployKey: null}`, `sourceDir === <dir>/kb`.
  - `indexes git.path inside the clone`: `git.path: "/docs"` → `git.path === "docs"`, `sourceDir === <dir>/kb/docs`.
  - `resolves deployKey against the config dir`: `deployKey: ./deploy_key` → `<dir>/deploy_key`.
  - `requires path with git`: errors contain `path: required when git is set`.
  - `rejects git.path escaping the repo`: `git.path: "../x"` → error starting `git > path:`.
  - `rejects unknown git fields and a missing url, all at once`: `git: {branch: main, foo: 1}` → two errors (`git > url`, `git`/unrecognized key).
  - `git is null without the block`: existing config → `git === null`.
- [ ] **Step 2: Run** `npx vitest run test/config.test.ts`, expected FAIL (unknown key `git`).
- [ ] **Step 3: Implement** in `config.ts`: `GitSchema = z.object({url: z.string().trim().min(1), branch: z.string().trim().min(1).default("main"), path: z.string().optional(), deployKey: z.string().min(1).optional()}).strict()`; add `git: GitSchema.optional()` to `ConfigSchema`. A `normalizeGitPath(raw): {path: string} | {error: string}` helper: drop leading `/`, split on `/`, drop `.` and empty segments, reject `..`, `\`, `CONTROL_CHARS`. Push errors into the existing `errors` array so they are collected with the rest. `sourceDir` per the Interfaces block.
- [ ] **Step 4: Run** `npx vitest run test/config.test.ts`, expected PASS; `npm run typecheck` clean.
- [ ] **Step 5: Docs**: requirements config table gets `git` row and a `**git**` rules paragraph copied from the spec's Config section; roadmap stage 15.
- [ ] **Step 6: Commit** `Add git block to the config`.

---

### Task 2: Clone on first run

**Files:**
- Create: `src/core/git.ts`
- Modify: `src/core/errors.ts` (`GitError`), `src/core/index.ts` (export `syncGitSource`, `redactUrl`, `GitError`, type `GitSyncResult`)
- Modify: `test/helpers.ts` (origin repo helper)
- Test: `test/git.test.ts`

**Interfaces:**
- Consumes: `GitSource` (Task 1).
- Produces:
  ```ts
  export class GitError extends Error {}                       // errors.ts
  export interface GitSyncResult {
    action: "cloned" | "updated" | "unchanged" | "skipped";
    commit: string | null;   // "<short sha> <ISO commit date>", null if unknown
    warnings: string[];
  }
  export async function syncGitSource(git: GitSource, log: (line: string) => void): Promise<GitSyncResult>;
  export function redactUrl(url: string): string;
  // internal, exported for tests:
  export function gitEnv(git: GitSource): NodeJS.ProcessEnv;   // process.env + GIT_TERMINAL_PROMPT=0 (+ ssh in Task 4)
  ```
  test/helpers.ts:
  ```ts
  export function git(cwd: string, ...args: string[]): string; // execFileSync, trimmed stdout, -c user.name/-c user.email set
  export interface Origin { url: string; dir: string; commit(files: Record<string, string>, message?: string): string /* sha */ }
  export function makeOrigin(files: Record<string, string>, opts?: { branch?: string }): Origin;
  // bare repo `init --bare -b <branch>`, `uploadpack.allowFilter true`, url = pathToFileURL(dir).href; commit() pushes from a scratch clone
  ```

- [ ] **Step 1: Write failing tests** (`describe("syncGitSource clone")`):
  - `clones into path`: origin `{"docs/a.md": "# A", "README.md": "x"}`, `git.path: ""` → result `action: "cloned"`, `commit` matches `/^[0-9a-f]{7,} \d{4}-/`, both files exist in `repoDir`.
  - `sparse clone checks out only git.path`: `git.path: "docs"` → `docs/a.md` exists, `src/b.md` (added to origin) does not.
  - `warns when git.path is missing in the repo`: `git.path: "nope"` → warnings contain `git.path not found in the repository: nope`.
  - `failed clone leaves nothing behind`: `branch: "missing"` → rejects with `GitError`; `repoDir` and any `*.clone-*` sibling do not exist.
  - `redactUrl hides userinfo`: `https://u:s@h/x.git` → `https://***@h/x.git`; `git@h:t/x.git` unchanged.
  - `gitEnv disables prompts and has no ssh command without deployKey`: `GIT_TERMINAL_PROMPT === "0"`, `GIT_SSH_COMMAND` equal to `process.env.GIT_SSH_COMMAND` (untouched).
- [ ] **Step 2: Run** `npx vitest run test/git.test.ts`, expected FAIL (module missing).
- [ ] **Step 3: Implement** `syncGitSource` clone branch when `repoDir` does not exist: `run(args, cwd?)` wrapper over `execFile("git", …, {env: gitEnv(git)})` resolving `{ok, stdout, stderr}`; ENOENT → `GitError("git not found; install git or remove the git block")`. Clone to `<repoDir>.clone-<pid>`, `sparse-checkout set <git.path>` if set, `renameSync` to `repoDir`; on any failure `rmSync` the temp dir and throw `GitError` with redacted URL and git's stderr. Log `git: cloning <redacted url> (<branch>)` first and `git: <redacted url> (<branch>) at <commit>` last (`git log -1 --format=%h %cI`). The `git.path` existence check runs at the end of every `syncGitSource` call (Task 3 reuses it).
- [ ] **Step 4: Run** `npx vitest run test/git.test.ts`, expected PASS.
- [ ] **Step 5: Commit** `Clone the knowledge repo from the config`.

---

### Task 3: Update an existing clone

**Files:**
- Modify: `src/core/git.ts`
- Test: `test/git.test.ts`

**Interfaces:**
- Consumes: Task 2 internals (`run`, logging, `git.path` check).
- Produces: no new exports; `syncGitSource` handles existing `repoDir`.

- [ ] **Step 1: Write failing tests** (`describe("syncGitSource update")`), each starts from a clone made by a first `syncGitSource` call unless stated:
  - `fast-forwards to a new commit`: `origin.commit({"docs/b.md": "# B"})` → `action: "updated"`, `docs/b.md` exists.
  - `reports unchanged when origin did not move`: → `action: "unchanged"`, no warnings.
  - `keeps local changes`: edit `docs/a.md` in `repoDir`, new origin commit → `action: "skipped"`, warning contains `local changes in`, file keeps the local edit.
  - `skips another branch`: `git checkout -b feature` in `repoDir` → warning `is on feature, config says main; not updating`.
  - `skips detached HEAD`: `git checkout --detach` → warning contains `is on detached HEAD`.
  - `warns on diverged history`: commit locally in `repoDir`, commit different content in origin → warning contains `cannot fast-forward`, local commit kept.
  - `fetch failure keeps the content`: `rmSync(origin.dir)` → warning contains `fetch failed, indexing the previous content`, no throw.
  - `sparse set follows git.path`: sparse clone with `git.path: "docs"`, then call with `git.path: "src"` → `src/b.md` exists.
  - `updates a hand-made full clone without making it sparse` (Review Focus 1): `git clone <origin.url> repoDir` manually, origin commit → `action: "updated"`, `git config core.sparseCheckout` not `true`.
  - `matches origin ignoring trailing .git and slash` (Review Focus 2): origin cloned with url `<url>`, config `git.url: <url>/` → no error. And url `…/kb.git` vs `…/kb` the same (create the bare repo as `kb.git`).
  - `refuses a plain directory`: `repoDir` exists with a file, no `.git` → `GitError` `path exists and is not a git repository`.
  - `refuses a directory inside another repo`: `repoDir` is a subdirectory of a git repo → same error.
  - `refuses a clone of another repo`: second origin → `GitError` containing `is a clone of` and `remove the directory to re-clone`.
- [ ] **Step 2: Run** `npx vitest run test/git.test.ts`, expected new tests FAIL.
- [ ] **Step 3: Implement** the existing-`repoDir` branch in the spec's order: toplevel check (`realpathSync` both sides), origin check (`normalizeRemote` strips trailing `/` then `.git`), then `status --porcelain`, `symbolic-ref --short -q HEAD` (empty → `detached HEAD`), `fetch origin <branch>`, compare `HEAD` with `FETCH_HEAD` (equal → `unchanged`), `merge --ff-only FETCH_HEAD`; if `config --bool core.sparseCheckout` is `true`, `sparse-checkout set <git.path>` (or `disable` when `git.path` is ""). Warnings go to `result.warnings` with the spec's wording.
- [ ] **Step 4: Run** `npx vitest run test/git.test.ts`, expected PASS.
- [ ] **Step 5: Commit** `Fast-forward an existing knowledge clone`.

---

### Task 4: Deploy key and SSH

**Files:**
- Modify: `src/core/git.ts`
- Test: `test/git.test.ts`

**Interfaces:**
- Consumes: `gitEnv`, `run` (Task 2).
- Produces (exported for tests):
  ```ts
  export function explainGitFailure(stderr: string, git: GitSource): string; // message for GitError / warning
  ```

- [ ] **Step 1: Write failing tests** (`describe("deploy key")`):
  - `gitEnv sets the ssh command with a deploy key`: `deployKey: "/k/key"` → `GIT_SSH_COMMAND === 'ssh -i "/k/key" -o IdentitiesOnly=yes -o UserKnownHostsFile="/k/key.known_hosts" -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15'`.
  - `generates a missing key and stops` (`it.skipIf(!hasSshKeygen)`): `deployKey` in a temp dir, not existing → rejects with `GitError` whose message contains `ssh-ed25519 ` and `add this key to the repository as a read-only deploy key`; key file exists with mode `0o600`; `repoDir` not created.
  - `tightens key permissions`: existing key with mode `0o644` and a file:// origin → after the call mode is `0o600`.
  - `explains a changed host key`: stderr with `REMOTE HOST IDENTIFICATION HAS CHANGED` → `the git host key has changed; if expected, delete /k/key.known_hosts`.
  - `repeats the public key on auth failure`: stderr `Permission denied (publickey)`, `/k/key.pub` containing `ssh-ed25519 AAAA test` → message contains that line.
  - `passes other errors through redacted`: stderr containing `https://u:s@h/x` → `https://***@h/x`.
- [ ] **Step 2: Run** `npx vitest run test/git.test.ts`, expected new tests FAIL.
- [ ] **Step 3: Implement**: at the start of `syncGitSource`, when `deployKey` is set: missing → `execFile("ssh-keygen", ["-t","ed25519","-N","","-C","marian-knows","-f",key])`, read `.pub`, throw `GitError`; else `chmodSync(key, 0o600)` if `mode & 0o077`. Paths in `GIT_SSH_COMMAND` double-quoted. Route every git stderr in errors and warnings through `explainGitFailure`.
- [ ] **Step 4: Run** `npx vitest run test/git.test.ts`, expected PASS.
- [ ] **Step 5: Commit** `Use a deploy key for the knowledge repo`.

---

### Task 5: `index` runs the git step

**Files:**
- Modify: `src/cli.ts` (`index()`, error handling, USAGE line if it describes `index`)
- Test: `test/cli.test.ts`
- Docs: `docs/requirements.md` `index` section (git step, warnings, errors); `README.md` if it shows a config

**Interfaces:**
- Consumes: `syncGitSource`, `GitError` (Tasks 2–4), `LoadedConfig.git` (Task 1).

- [ ] **Step 1: Write failing tests** (`describe("index with git")`):
  - `clones and indexes`: config `path: ./kb`, `git: {url: <origin.url>, path: docs}`, origin `{"docs/a.md": "# Alpha"}` → `runCli(["index"])` code 0, stderr contains `git: ` and `at `, then `runCli(["scan"])` stdout is `/a.md`.
  - `prints git warnings and still indexes`: local edit in `kb` before a second `index` → code 0, stderr contains `warning: local changes in`.
  - `git errors exit 2`: `git.url` pointing at a missing dir → code 2, stderr starts with `error: `, no `.marian-knows` index created.
  - `scan does not touch git`: config with git, no clone yet → `runCli(["scan"])` code 0, `kb` still does not exist.
- [ ] **Step 2: Run** `npx vitest run test/cli.test.ts`, expected FAIL.
- [ ] **Step 3: Implement** in `index()`: if `config.git`, `await syncGitSource(config.git, (l) => console.error(l))`, `warn(result.warnings)`, then the existing `syncIndex`. `GitError` falls into the existing exit-2 branch; no new branch needed unless the message needs no prefix.
- [ ] **Step 4: Run** `npm run typecheck && npm test`, expected all PASS.
- [ ] **Step 5: Docs**: requirements `index` section per the spec's Behavior section (only `index` touches git; clone/update/warning table; deploy key behavior).
- [ ] **Step 6: Commit** `Pull the knowledge repo in index`.

---

### Task 6: Docker without git logic

**Files:**
- Modify: `docker/entrypoint.sh`, `Dockerfile`, `docker/compose.example.yml`, `docs/docker.md`

- [ ] **Step 1: Entrypoint**: remove `git_quiet`, `GIT_SSH_COMMAND`, the `KNOWLEDGE_REPO` block and the deploy key `chmod`. Add after the config check: `[ -n "${KNOWLEDGE_REPO:-}" ] && log "! warning: KNOWLEDGE_REPO is ignored; move the repo to git: in marian-knows.yml"`. Keep chown/setpriv, lock removal, `marian-knows index`, `exec … serve`.
- [ ] **Step 2: Dockerfile**: drop `KNOWLEDGE_DIR` and `KNOWLEDGE_BRANCH` from `ENV`; keep `git openssh-client`; runtime comment says git and ssh are used by `marian-knows index`.
- [ ] **Step 3: compose.example.yml**: environment keeps only `TZ` (keep the user's current uncommitted formatting of comments).
- [ ] **Step 4: docs/docker.md** per the spec's Docker section: steps become directory → copy compose as is → `data/marian-knows.yml` with `path: ./knowledge` and `git: {url, deployKey: ./deploy_key}` → first `docker compose up -d` prints the public key and the container restarts until it is added → add as read-only deploy key → `docker compose restart` → tokens, HTTPS, agent. Sample start log updated to the new `git:` lines. Section "Bez gita" (bind mount `/srv/docs:/knowledge:ro` + `path: /knowledge`, or files in `data/knowledge`). Section "Migracja ze starej konfiguracji" (spec's migration bullet). Awarie table: replace `KNOWLEDGE_REPO` wording, host key row says `rm data/deploy_key.known_hosts`, add `local changes` / `cannot fast-forward` rows. The file stays in Polish like the rest of it.
- [ ] **Step 5: Verify image** builds and starts: `docker build -t marian-knows:git-test .`, then in a scratch dir with `data/marian-knows.yml` = `name: Dart docs`, `path: ./knowledge`, `git: {url: https://github.com/dart-lang/sdk.git, path: /docs}` run `docker run --rm -p 127.0.0.1:3000:3000 -v "$PWD/data:/data" marian-knows:git-test`. Expected log: `git: cloning https://github.com/dart-lang/sdk.git (main)`, `git: … at <sha> <date>`, `Files: 44` (± drift), `MCP over HTTP`. Restart once more: `unchanged`, `+ 0 added`.
- [ ] **Step 6: Commit** `Move git out of the Docker entrypoint`.

---

### Task 7: Manual smoke test from source

- [ ] **Step 1**: scratch dir, same Dart config as Task 6 Step 5; `npm run dev -- index --config <scratch>/marian-knows.yml` twice. Expected: first `cloned` in a few seconds, `.git` around 10 MB; second `unchanged`.
- [ ] **Step 2**: `npm run dev -- search "release" --config …` returns hits with virtual paths without a `/docs` prefix.
- [ ] **Step 3**: report results in the PR description / to the user; nothing to commit.
