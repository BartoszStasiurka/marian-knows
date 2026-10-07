# MarianKnows

Markdown knowledge base with full-text search (SQLite FTS5). CLI first, MCP later.

The `.md` files are the source of truth; the SQLite index is a disposable derivative you can delete and rebuild
at any time. Full requirements: [docs/requirements.md](docs/requirements.md) (Polish). Plan: [docs/roadmap.md](docs/roadmap.md).

## Install

Requires Node.js 20+. The package is not on the npm registry; install it from a checkout.

```bash
git clone <repo> marian-knows && cd marian-knows
npm install
npm run build
npm link                 # puts `marian-knows` on PATH
```

Or build a tarball and install that anywhere:

```bash
npm pack                 # runs a clean build, writes marian-knows-<version>.tgz
npm install -g ./marian-knows-0.1.0.tgz
```

`better-sqlite3` is a native module. It ships prebuilt binaries for common platforms; elsewhere its install
script compiles it and needs a C++ toolchain. If your npm asks you to approve install scripts, approve
`better-sqlite3`.

## Quick start

```bash
cd ~/notes
marian-knows init "My notes"     # creates ./marian-knows.yml (never overwrites)
marian-knows index               # builds .marian-knows/marian-knows/index.db next to the config
marian-knows search backup postgres --snippets
marian-knows get /ops/backup.md
marian-knows get /ops/backup.md#restore   # one section, by the anchor search returned
```

Add `.marian-knows/` to your `.gitignore`; `init` does not touch it.

## Config

One `marian-knows.yml` describes one project with one source directory:

```yaml
name: Customer knowledge base   # required, 1-128 chars
description: >                  # optional, up to 2000 chars; shown to MCP agents
  Support procedures and product FAQ, in Polish. Check here before answering
  questions about orders, returns or shipping.
path: ./docs                    # optional, relative to this file; defaults to its directory
exclude:                        # optional, a glob or a list of globs relative to path
  - "**/draft/**"
```

- Scanning is recursive and picks up `.md` files only.
- Hidden files and directories and `node_modules` are always skipped.
- Files over 1 MB and names containing `#` or `?` are skipped with a warning.
- A missing `path` directory is a warning, not an error.

Config lookup: `--config <file>`, then `MARIAN_KNOWS_CONFIG`, then `marian-knows.yml` searched upwards from the
current directory. The index lives in `.marian-knows/<config file name without extension>/` next to the config
(`marian-knows.yml` → `.marian-knows/marian-knows/index.db`), so several configs in one directory, e.g.
`public.yml` and `internal.yml`, keep separate indexes and logs.

### Virtual paths

Every file is addressed by its path relative to `path`, starting with `/`: with `path: ./docs`, the file
`docs/api/readme.md` is `/api/readme.md`. Output and the index contain virtual paths only; disk paths appear only
in diagnostics (`scan --disk`, `status`).

## Commands

| Command               | What it does                                                                      |
| --------------------- | --------------------------------------------------------------------------------- |
| `init <project_name>` | Create a minimal `marian-knows.yml`; `--config` picks the file to create          |
| `scan`                | List files the index would contain, without indexing (`--json`, `--disk`)         |
| `parse <file>`        | Show how a Markdown file (disk path) splits into sections; no config (`--json`)   |
| `index`               | Sync the index incrementally; `--full` rebuilds from scratch                      |
| `search <query>`      | Files ranked by relevance, one virtual path per line                              |
| `list`                | Indexed files sorted by path                                                      |
| `get <path>[#anchor]` | Print an indexed file unchanged, or one section of it                             |
| `status`              | Project, config and index state (`--json`)                                        |
| `destroy`             | Remove this config's index and query logs; the config and `.md` files stay        |
| `log`                 | Show the query log and MCP sessions (`--days`, `--zero`, `--json`)                |
| `serve`               | Run the MCP server over stdio for AI agents                                       |
| `help`                | Show help (also `--help`, `-h`)                                                   |

### Search

```bash
marian-knows search konfiguracja nginx          # all words must match
marian-knows search backup -n 3 --snippets      # top 3, snippet with [matches] under each path
marian-knows search deploy --tag ops --path /server/ --exclude-path /server/old/
marian-knows search "pg_restore" --exact
```

- Words are joined with AND. With fewer than 3 results and more than one meaningful word, OR results are
  appended below the strict ones.
- Polish inflection without a stemmer: words longer than 4 letters lose their last 2 (keeping at least 4) and
  match as a prefix, so `konfiguracja` finds "konfiguracji". Diacritics are ignored (`zolw` finds "żółw").
- Common PL/EN stop words, including question words (`ile`, `kto`, `should`), are dropped, unless the query
  is only stop words.
- `--exact` turns off trimming, prefix matching and the OR fallback.
- `-n <limit>` (default 10), `--tag <tag>` (case-insensitive).
- `--path` and `--exclude-path` take virtual paths and are repeatable. A trailing `/` means a directory
  (`/proj/A/` does not include `/proj/AB/`), otherwise a single file. `--path` values are OR-ed; all filters
  apply before ranking and the limit.

`list` takes the same `--tag`, `--path` and `--exclude-path` filters.

### Get

- `get /a.md` prints the file as it is on disk. `get /a.md#backup` prints the section with that anchor: its
  heading line and every part of it (a long section is split into parts that share the anchor). An unknown
  anchor is an error that lists the anchors the file has.
- Output is capped at 20000 characters. A cut file ends with a `[truncated: …]` notice that lists the
  file's anchors, so the next call can read one section. `--max-chars <n>` changes the cap, `0` turns it off.

### Query log

`search`, `get` and `list` append one JSON line per call to `.marian-knows/<config name>/logs/queries-YYYY-MM-DD.jsonl`
(UTC day): time, source, who, operation, query, filters, result count, top 5 virtual paths, duration. No
response content and no disk paths. Files older than 90 days are deleted on write; `destroy` removes the
logs with the index. A failed write is a warning, never an error. `MARIAN_KNOWS_NO_LOG=1` turns the log off.

MCP sessions go to the same file: `connect` with the client's name and version, `disconnect` with the number of
tool calls and the session length. `--zero` leaves them out.

```bash
marian-knows log                  # last 7 days, oldest first
marian-knows log --zero --days 30 # queries with no results: gaps in the knowledge base
```

## MCP server

`marian-knows serve` exposes the knowledge base to AI agents over MCP (stdio). It is read-only and uses the
config found the usual way (`--config`, `MARIAN_KNOWS_CONFIG`, search upward). Run `index` first; the server
does not sync the index yet.

```bash
claude mcp add kb -- marian-knows serve --config /path/to/marian-knows.yml
```

The agent decides whether to use the base from the server instructions and the `search` description, and both
start with the config's `name` and `description`. Write `description` for the agent: what the base holds,
in which language, and when to check it. Without one, the agent only learns that a knowledge base exists.

| Tool     | Arguments                                                    | Result                                     |
| -------- | ------------------------------------------------------------ | ------------------------------------------ |
| `search` | `query`, `limit` (1-50), `tag`, `path[]`, `excludePath[]`, `exact` | JSON array as `search --json`, snippets always filled |
| `get`    | `path` (`/a.md` or `/a.md#anchor`)                           | Markdown, capped at 20000 characters       |
| `list`   | `tag`, `path[]`, `excludePath[]`                             | JSON array as `list --json`                |
| `status` | none                                                         | `status --json` without `config` and `path` (disk paths) |

Virtual paths only. Errors (invalid path, unknown anchor, missing index) come back as tool errors with the
CLI message; a scope that covers no file adds a `warning:` text block. Calls go to the query log with
`source: "mcp"` and `who: "local"`, framed by `connect` and `disconnect`. Over stdio a session lasts until the
client closes stdin or the server gets SIGINT / SIGTERM; a killed server logs no `disconnect`.

File content reaches the agent's context unchanged: whoever can write to the knowledge repo can steer
connected agents (prompt injection), so treat write access to it as an admin right.

## JSON output

`search`, `list`, `status`, `log`, `scan` and `parse` accept `--json`. With `--json`, stdout carries JSON only;
warnings and errors go to stderr.

The `search`, `list` and `status` shapes are a stable contract. Adding fields is backwards compatible;
removing a field or changing its meaning requires a major version bump.

`search` and `list` print a bare array, one object per file, in rank order (`list`: by path). No results
print `[]` with exit code 1. Fields are never omitted: a missing value is `null`, missing tags are `[]`.

```bash
$ marian-knows search backup --json -n 1 --snippets
[{"path":"/server/deploy.md","title":"Deploy","tags":["ops"],"score":-8.41,"anchor":"harmonogram","heading":"Harmonogram","snippet":"…[backup] bazy…"}]

$ marian-knows list --json
[{"path":"/server/deploy.md","title":"Deploy","tags":["ops"]}]
```

| Field     | `search` | `list` | Meaning                                                               |
| --------- | :------: | :----: | --------------------------------------------------------------------- |
| `path`    | ✓        | ✓      | Virtual path                                                          |
| `title`   | ✓        | ✓      | Frontmatter `title`, else first H1, else file name                    |
| `tags`    | ✓        | ✓      | Frontmatter `tags` as an array                                        |
| `score`   | ✓        |        | `bm25`, lower is better; comparable only within one query             |
| `anchor`  | ✓        |        | Anchor of the file's best-matching section, `null` for the file start |
| `heading` | ✓        |        | Heading of that section, `null` for the file start                    |
| `snippet` | ✓        |        | Snippet with `[...]` matches; `null` without `--snippets`             |

`status --json` prints one object:

```json
{"name":"My notes","description":null,"config":"/home/me/notes/marian-knows.yml","path":"/home/me/notes","pathExists":true,
 "exclude":[],"index":"ok","files":42,"sections":310,"dbSize":1048576,
 "indexedAt":"2026-01-01T10:00:00.000Z","ageSeconds":120}
```

`index` is `ok`, `missing` or `outdated`. When it is not `ok`, the index fields (`files`, `sections`,
`indexedAt`, `ageSeconds`) are `null`; `dbSize` is also `null` for `missing`. `description` is `null` when the config has
none.

## Exit codes

| Code | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | OK                                                                                               |
| 1    | No results from `search`, `list` or `log` (like `grep`)                                          |
| 2    | Error: missing or invalid config, invalid virtual path, unknown anchor, missing index, bad arguments, `index` already running, unexpected failure |

## Library

The core logic is importable from Node:

```js
import { findConfig, loadConfig, syncIndex, search } from "marian-knows/core";
```

Only the `marian-knows/core` entry point is exported. Its API is not yet covered by the stability promise that
applies to the JSON output.

## Development

```bash
npm test                  # vitest, including the search quality sets (hit@5, MRR)
npm run typecheck
npm run build
npm run dev -- search x   # run the CLI from source
npx tsx test/quality.ts   # quality report without vitest
```
