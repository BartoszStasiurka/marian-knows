---
title: Config reference (marian-knows.yml)
tags: [reference, config]
---

# Config reference

One `marian-knows.yml` describes one project with one source directory.

```yaml
name: Customer knowledge base   # required
description: >                  # optional; shown to MCP agents
  Support procedures and product FAQ, in Polish. Check here before answering
  questions about orders, returns or shipping.
path: ./docs                    # optional; default: the config's directory
exclude:                        # optional
  - "**/draft/**"
sync: 15                        # optional; minutes between index refreshes in serve
git:                            # optional; see Git source
  url: git@git.example.com:team/knowledge.git
```

Unknown fields are an error. Validation reports all errors at once, exit code 2. The legacy `sources` field is
rejected with its own message.

## name

Required. 1 to 128 characters after trimming, no control characters. Metadata only: it does not affect where the
index lives. The MCP server gives it to the agent together with `description`.

## description

Optional. 1 to 2000 characters after trimming, may span lines. Written for an AI agent: what the base holds, in
which language, when to check it. It starts the MCP server instructions and the `search` tool description, and
shows in `status`. Without it, a connected agent only learns that a base exists.

## path

Optional. The source directory, relative to the config's directory or absolute. Missing means the config's
directory. Scanning is always recursive.

- An existing `path` must be a directory; a file is a config error.
- A missing directory is a warning, not an error: `scan` finds no files.
- An access error (e.g. no permission) is a config error.
- With `git`, `path` is required and is the working copy.

## exclude

Optional. A glob or a list of globs, relative to `path`. Always skipped regardless of `exclude`: hidden files
and directories (starting with `.`) and `node_modules`.

## sync

Optional. Whole minutes from 0 to 1440, default 15: the pause between the end of one index refresh in `serve`
and the start of the next. `0` refreshes only at start. `index` ignores it.

## git

Optional. Clone the source from a git repository and fast-forward it on every `index`.

| Field       | Required | Meaning                                                                              |
| ----------- | -------- | ------------------------------------------------------------------------------------ |
| `url`       | yes      | Anything `git clone` accepts: ssh, https, file                                       |
| `branch`    | no       | Default `main`; not empty, must not start with `-`                                   |
| `path`      | no       | Directory inside the repo to index (sparse checkout); leading `/` ignored; `.` or empty = repo root; `..`, `\` and control characters are errors |
| `deployKey` | no       | Private key file, relative to the config or absolute; generated when missing          |

The indexed directory is `path` + `git.path`. Loading the config never runs git. How it behaves:
[Git source](../guides/git-source.md).

## What gets scanned

- `.md` files only.
- Files over 1 MB and names containing `#` or `?` are skipped with a warning.
- Paths differing only by case: the first in code-point order wins, the rest are skipped with a warning.

## Finding the config

`--config <file>`, then the `MARIAN_KNOWS_CONFIG` environment variable, then `marian-knows.yml` searched upwards
from the current directory. `init` uses only `--config` or `./marian-knows.yml`.

## Files next to the config

| File                              | What it is                                   |
| --------------------------------- | -------------------------------------------- |
| `.marian-knows/<config name>/`    | Index, lock, query and access logs           |
| `<config name>.tokens.json`       | HTTP tokens (hashes); keep out of git        |
| `<deployKey>`, `.pub`, `.known_hosts` | Deploy key and pinned git host keys      |

`<config name>` is the config file name without extension: `marian-knows.yml` → `marian-knows`.
