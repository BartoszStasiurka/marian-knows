# Git source in the config

Status: design, approved in conversation 2026-10-08. Roadmap: new stage 15 "Git source".

## Goal

Running a piece of documentation in a container should take as little Docker work as possible. Today one knowledge
repo is described in three places that must agree: `KNOWLEDGE_REPO` / `KNOWLEDGE_BRANCH` in `compose.yml`,
`KNOWLEDGE_DIR` in the image, and `path: knowledge` in `marian-knows.yml`. After this change the repo is described
once, in `marian-knows.yml`, and `compose.yml` is copied without edits.

Git handling moves from `docker/entrypoint.sh` into `src/core/`, so it also works outside Docker (`marian-knows index`
on a laptop pointing at a remote repo).

The clone is a normal git working copy at a path the user chooses. People can work in it without MarianKnows, so
MarianKnows never discards local changes.

## Config

```yaml
name: Team knowledge
path: ./knowledge            # working copy: cloned here, indexed from here
git:
  url: git@git.example.com:team/knowledge.git
  branch: main               # optional, default main
  path: docs                 # optional: index only this directory of the repo
  deployKey: ./deploy_key    # optional: path to a private key file, never the key itself
```

| Field           | Rules |
| --------------- | ----- |
| `git.url`       | required, non-empty string; any URL `git clone` accepts (ssh, https, file) |
| `git.branch`    | optional, non-empty, must not start with `-`, default `main` |
| `git.path`      | optional; directory inside the repo; a leading `/` is ignored (`/docs` = `docs`); `..` segments, `\` and control characters are config errors; `.` or empty after normalization = repo root |
| `git.deployKey` | optional; relative to the config directory or absolute |

- `git` is strict: unknown fields are errors, collected with all other config errors (exit 2).
- With `git`, top-level `path` is **required** (config error otherwise). Cloning into the config directory itself would
  mix the repo with `marian-knows.yml`, tokens and `.marian-knows/`.
- Top-level `path` keeps its meaning and stays a string. The indexed directory (`sourceDir`) is
  `path` + `git.path`. Virtual paths are relative to `sourceDir`, so `git.path: docs` and `docs/api/x.md` give
  `/api/x.md`. The index format does not change.
- `path` not existing is still not a config error; with `git` it is the normal state before the first clone.
- Removing the `git` block leaves a working config on a local directory.
- `LoadedConfig` gets `git: { url, branch, path, deployKey } | null`, with `deployKey` resolved to an absolute path
  and `git.path` normalized. `loadConfig` does not run git; it stays a pure parse-and-validate step.

## Behavior

Only `index` touches git. It runs the git step before scanning. `scan`, `search`, `status` and `serve` never do. (Stage
13 will call the same core function from `serve`.)

New module `src/core/git.ts`, one entry point:

```ts
syncGitSource(git: GitSource, log: (line: string) => void): Promise<GitSyncResult>
```

It runs the `git` binary through `child_process.execFile` (no new npm dependency). The `index` adapter in `src/cli.ts`
calls it before `syncIndex` when `config.git` is set and prints its lines. It then reloads the config (the source
directory may have just appeared) and skips `syncIndex` with a warning when the indexed directory still does not
exist, so a `git.path` typo never empties a working index.

### First run: `path` does not exist or is an empty directory

1. `git clone --depth 1 --filter=blob:none --single-branch --branch <branch> [--sparse] <url> <path>`
   (`--sparse` only with `git.path`; then `git sparse-checkout set --cone <git.path>`, cone forced against user config).
2. The clone goes to a sibling temp directory (`<path>.clone-<pid>`) and is renamed to `<path>` only when complete, so an interrupted clone never leaves a half-made `path`. Failure: `GitError`, exit 2, nothing indexed, temp directory removed.
3. `git.path` set but missing in the checked out tree: warning `git.path not found in the repository: <git.path>` (checked after every run, clone or update).

Shallow + partial + sparse keeps big monorepos cheap. Measured on `https://github.com/dart-lang/sdk.git` with
`git.path: docs`: 2.4 s, 11 MB on disk, 44 `.md` files.

### Later runs: `path` exists

Checks, in order. Any failure here is fatal (`GitError`, exit 2) because the config points at the wrong thing:

- `path` is the top of a git working copy (`git rev-parse --show-toplevel` equals `path`, both compared after
  `realpath`; a directory inside some other repo does not count). Otherwise:
  `path exists and is not a git repository: <path>`. MarianKnows never writes into a directory it did not clone.
- `remote.origin.url` equals `git.url`, compared after dropping a trailing `/` and `.git` (`…/sdk` = `…/sdk.git`). Otherwise: `<path> is a clone of <origin>, config says <url>; remove the
  directory to re-clone`.

Then the update. Every problem below is a **warning**: the index is built from what is on disk, because a stale base
beats no server.

| Situation | Warning |
| --- | --- |
| uncommitted changes (`git status --porcelain` non-empty) | `local changes in <path>, not updating` |
| checked out branch ≠ `git.branch`, or detached HEAD (current = `detached HEAD`) | `<path> is on <current>, config says <branch>; not updating` |
| `git fetch origin <branch>` fails (network, auth, host down) | `fetch failed, indexing the previous content` + git's message |
| `git merge --ff-only FETCH_HEAD` fails (diverged, force push) | `cannot fast-forward <path>; indexing the local content` |

If the clone is sparse (`core.sparseCheckout` true), `git sparse-checkout set --cone <git.path>` runs on every update, so
changing `git.path` in the config needs no re-clone. A clone that is not sparse (e.g. made by hand) is left as it is.

Success line: `git: <url> (<branch>) at <short sha> <commit date ISO>`.

### SSH and the deploy key

Only when `git.deployKey` is set. Without it, git runs with the user's normal environment (`~/.ssh`, agent, config),
which is what a laptop wants.

- Key file missing: generate it with `ssh-keygen -t ed25519 -N "" -C marian-knows -f <deployKey>`, print the public
  key and `add this key to the repository as a read-only deploy key, then run index again`, exit 2 without trying
  git. In the container this replaces the manual `ssh-keygen` step.
- Key file with group/other permissions: `chmod 600` before use (ssh refuses such keys).
- `GIT_SSH_COMMAND="ssh -i <deployKey> -o IdentitiesOnly=yes -o UserKnownHostsFile=<deployKey>.known_hosts
  -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15"`.
- Auth failure (`Permission denied (publickey)`) with a deploy key: the message repeats the public key from
  `<deployKey>.pub`, if present, so the log says what to add.
- Changed host key (`REMOTE HOST IDENTIFICATION HAS CHANGED`): one actionable line instead of ssh's banner:
  `the git host key has changed; if expected, delete <deployKey>.known_hosts`. Fatal on clone, warning on update.

### Always

- `GIT_TERMINAL_PROMPT=0`: git never waits for a password.
- `git` binary missing: `GitError` `git not found; install git or remove the git block`.
- Userinfo in URLs is redacted in every printed line (`https://user:secret@host/x` → `https://***@host/x`). The docs
  recommend `deployKey` over credentials in URLs.

## Docker

- `entrypoint.sh` loses everything git-related (`GIT_SSH_COMMAND`, clone/fetch, `git_quiet`, the deploy key chmod).
  It keeps: chown and switch to `node`, missing-config check, stale lock removal, `marian-knows index`, `serve`.
  If `KNOWLEDGE_REPO` is still set it prints `KNOWLEDGE_REPO is ignored; move the repo to git: in marian-knows.yml`.
- Dockerfile: drop `KNOWLEDGE_DIR` and `KNOWLEDGE_BRANCH`. Keep `git`, `openssh-client` (also provides `ssh-keygen`).
- `compose.example.yml`: drop `KNOWLEDGE_REPO` / `KNOWLEDGE_BRANCH`; copied without edits.
- `docs/docker.md`: install becomes directory, compose (copy as is), `marian-knows.yml` with `git:`, first
  `up` prints the deploy key, add it, restart, tokens. A variant without git: bind mount `/srv/docs:/knowledge:ro` and
  `path: /knowledge`, or put files into `data/knowledge`.
- Migration of the existing server: config `path: ./knowledge` + `git.url` equal to the old `KNOWLEDGE_REPO` and
  `deployKey: ./deploy_key`. The existing `/data/knowledge` clone is reused (origin matches). `data/known_hosts` is
  re-learned as `data/deploy_key.known_hosts`; the old file can be deleted.
- Making the GHCR image public (removes `docker login`) is a package setting outside this change.

## Docs to update

`docs/requirements.md` (config section: `git` fields, `path` required with `git`, `sourceDir`; `index` section: git
step and its warnings/errors), `docs/roadmap.md` (stage 15), `docs/docker.md`, `README` if it shows a config.

## Testing

Automated tests use local repos only: a temp dir with a bare "origin" built by a helper in `test/helpers.ts`
(`git init --bare`, commits pushed from a scratch clone, `uploadpack.allowFilter true` so `--filter` works over
`file://`). No network in `npm test`. CI runners have git.

- config: valid `git` block; missing `git.url`; unknown field in `git`; `git` without `path`; `git.path` with `..`;
  `/docs` normalized to `docs`; `deployKey` resolved against the config dir; `sourceDir` = `path` + `git.path`.
- first clone: files present, `index` finds them with virtual paths relative to `git.path`; sparse clone has only
  `git.path` checked out; clone of a missing branch fails with exit 2 and leaves no directory.
- update: new commit in origin appears after `index`; local edit → warning, file unchanged; other branch checked out
  → warning; diverged history → warning; origin removed → fetch warning, index still built; `git.path` changed →
  sparse set follows.
- refusals: `path` is a plain directory; `path` is a clone of another URL.
- deploy key: missing file is generated with `600` and the run stops (skipped if `ssh-keygen` is unavailable);
  `GIT_SSH_COMMAND` is set only with `deployKey`.
- redaction of userinfo in output.

Manual smoke test before merging: `git.url: https://github.com/dart-lang/sdk.git`, `git.path: /docs`, run `index`
twice (clone, then no-op update), then the same config in the container with `docker compose up`.

## Out of scope

Periodic pull and webhook (stage 13), sync on `serve` start and `hostname:pid` lock (stages 13/14), `status` showing
the commit, several repos per config, credentials other than an ssh key file.
