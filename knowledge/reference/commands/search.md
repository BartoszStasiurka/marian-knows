---
title: search command
tags: [reference, cli, search]
---

# search

```
marian-knows search <query> [-n <limit>] [--snippets] [--tag <tag>] [--exact]
                    [--path <prefix>]... [--exclude-path <prefix>]... [--json]
```

Prints matching files, best first, one virtual path per line. No results: exit code 1.

| Option                  | Meaning                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `-n <limit>`            | Max number of files, default 10                                          |
| `--snippets`            | A snippet of the best section under each path, matches in `[...]`        |
| `--tag <tag>`           | Only files with this tag, case-insensitive                               |
| `--exact`               | No word trimming, no prefix match, no OR fallback                        |
| `--path <prefix>`       | Only this subtree (`/dir/`) or file (`/a.md`); repeatable, OR-ed         |
| `--exclude-path <prefix>` | Leave out a subtree or file; repeatable                                |
| `--json`                | Array of `{path, title, tags, score, anchor, heading, snippet}`          |

All filters apply before ranking and the limit.

## Examples

```bash
marian-knows search konfiguracja nginx          # all words must match
marian-knows search backup -n 3 --snippets
marian-knows search deploy --tag ops --path /server/ --exclude-path /server/old/
marian-knows search "pg_restore" --exact
```

```
$ marian-knows search backup --snippets
/server/deploy.md
  …codzienny [backup] bazy o 03:00…
```

How matching and ranking work: [How search works](../../concepts/how-search-works.md). JSON fields:
[JSON output](../json-output.md#search-and-list).
