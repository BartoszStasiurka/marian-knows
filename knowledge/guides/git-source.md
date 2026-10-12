---
title: Git source
tags: [guide, git, config, index]
---

# Git source

Keep the knowledge base in a git repository and let MarianKnows clone it and pull changes. `index` and the index
refresh in `serve` run git; `scan`, `search`, `status` and the other commands never do.

## Config

```yaml
path: ./knowledge                 # the working copy: cloned here, indexed from here (required with git)
git:
  url: git@git.example.com:team/knowledge.git
  branch: main                    # optional, default main
  path: docs                      # optional: index only this directory of the repo (sparse checkout)
  deployKey: ./deploy_key         # optional: private key file; created on the first run if missing
```

- `url`: anything `git clone` accepts (ssh, https, file).
- `path` is required with `git`. A clone in the config's own directory would mix the repo with the config,
  tokens and `.marian-knows/`.
- Virtual paths start at `git.path`: with `git.path: docs`, the repo file `docs/api/x.md` is `/api/x.md`.
- Remove the `git` block and the config keeps working on the local directory.

Field rules are in [Config reference](../reference/config.md#git).

## First run: clone

When `path` is missing or empty, `index` clones: shallow (`--depth 1`), blobs on demand, one branch, and sparse
when `git.path` is set. The clone is made next to `path` and renamed into place only when it is complete, so an
interrupted clone leaves nothing behind. A failed first clone is an error and nothing is indexed.

```
git: cloning git@git.example.com:team/knowledge.git (main)
git: git@git.example.com:team/knowledge.git (main) at 92be13a 2026-10-07T16:32:17+02:00
```

## Later runs: fast-forward

When `path` exists, it must be the root of a git repo whose `origin` is `git.url`. MarianKnows never writes to
a directory it did not clone. Then it runs `fetch` and `merge --ff-only`, never `reset` or `clean`: the working
copy is an ordinary repo and someone may be working in it.

These cases are warnings, and the index is built from what is on disk:

| Situation                                   | Warning                                                  |
| ------------------------------------------- | -------------------------------------------------------- |
| uncommitted changes                         | `local changes in <path>, not updating`                  |
| another branch or detached HEAD             | `<path> is on <branch>, config says <branch>; not updating` |
| fetch failed (network, key, server)         | `fetch failed, indexing the previous content: …`         |
| history diverged (force push)               | `cannot fast-forward <path>; indexing the local content` |
| `git.path` missing in the repo              | `git.path not found in the repository: <git.path>`       |

When the indexed directory does not exist after the git step, the previous index stays untouched: a typo in
`git.path` does not empty a working base. Changing `git.path` later does not need a new clone.

## Deploy key

Without `deployKey`, git uses your normal environment (`~/.ssh`, the ssh agent, `~/.ssh/config`). Public repos
over https need nothing.

With `deployKey` set:

1. The first `index` generates an ed25519 key at that path (mode 600), prints the public key and exits with
   code 2 without calling git.
2. Add the public key to the repository as a read-only deploy key (GitHub and Gitea: Settings → Deploy keys;
   GitLab: Settings → Repository → Deploy keys).
3. Run `index` again.

Git then uses only that key, never waits for a password and keeps host keys in `<deployKey>.known_hosts`.
On `Permission denied (publickey)` the message repeats the public key to add. A changed host key gives
`the git host key has changed; if expected, delete <deployKey>.known_hosts`. Confirm the change with the git
server's admin before deleting the file: it is the only protection against a spoofed server.

## Credentials in URLs

Credentials in `http(s)://user:pass@…` URLs are replaced with `***@` in all output. Prefer a deploy key or a
credential helper anyway: the URL sits in the config in plain text.
