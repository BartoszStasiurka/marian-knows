---
title: JSON output
tags: [reference, cli]
---

# JSON output

`scan`, `parse`, `search`, `list`, `tags`, `status`, `log` and `token list` accept `--json`. With `--json`,
stdout carries JSON only; warnings and errors go to stderr.

## Stability

The `search`, `list`, `tags` and `status` shapes are a stable contract, also used by the MCP tools. Adding
fields is backwards compatible; removing a field or changing its meaning requires a major version bump.

## search and list

A bare array, one object per file, in rank order (`list`: by path). No results: `[]` and exit code 1. Fields
are never omitted: a missing value is `null`, missing tags are `[]`.

```
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

## tags

An array of tag names in the text output's order; with `--counts`, an array of `{tag, count}`. Empty: `[]` and
exit code 1.

```
$ marian-knows tags --json --counts
[{"tag":"ops","count":12},{"tag":"hr","count":3}]
```

## status

One object:

```json
{"name":"My notes","description":null,"config":"/home/me/notes/marian-knows.yml","path":"/home/me/notes","pathExists":true,
 "exclude":[],"index":"ok","files":42,"sections":310,"dbSize":1048576,
 "indexedAt":"2026-01-01T10:00:00.000Z","ageSeconds":120,"tags":7}
```

- `index` is `ok`, `missing` or `outdated`. When it is not `ok`, `files`, `sections`, `indexedAt`, `ageSeconds`
  and `tags` are `null`; `dbSize` is `null` for `missing`.
- `tags` is the number of distinct tags. `description` is `null` when the config has none.
- The MCP `status` tool leaves out `config` and `path`.

## Other commands

- `scan --json`: an array of files.
- `parse --json`: one object `{title, tags, frontmatter, sections}`.
- `log --json`: a bare array of log entries; fields in [log](commands/log.md#entry-fields).
- `token list --json`: an array of `{name, createdAt, lastUsedAt}`.

These shapes are not covered by the stability promise.
