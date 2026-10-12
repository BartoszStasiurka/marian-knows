---
title: log command
tags: [reference, cli, logs]
---

# log

```
marian-knows log [--days <n>] [--zero] [--json]
```

Shows the query log: `search`, `get`, `list` and `tags` calls from the CLI and MCP, plus MCP sessions.

- Default: the last 7 days (n × 24 hours back), oldest first. `--days <n>` changes the window.
- `--zero`: only queries with no results, without session entries. These are the gaps in the base.
- `--json`: a bare array of entries.
- Empty log: exit code 1 (`[]` with `--json`). Damaged lines are skipped with a warning. Needs no index.

## Entry fields

| Field     | Meaning                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| `ts`      | ISO 8601 time, UTC                                                              |
| `source`  | `cli` or `mcp`                                                                  |
| `who`     | `cli`; `local` for MCP over stdio; the token name over HTTP                    |
| `op`      | `search`, `get`, `list`, `tags`; for sessions `connect` or `disconnect`         |
| `query`   | The query, or `path#anchor` for `get`; `null` for `list` and `tags`              |
| `filters` | Only those given: `tag`, `paths`, `excludePaths`, `limit`, `exact`, `counts`    |
| `results` | Number of files (`tags`: number of tags; `get`: 1)                              |
| `top`     | Up to 5 virtual paths (`tags`: tag names)                                       |
| `ms`      | Duration                                                                        |

Session entries: `connect` has `client` (`{name, version}` from the MCP client, or `null`); `disconnect` adds
`calls` (all tool calls in the session, failed ones and `status` included) and `ms` (session length).

Only successful calls are logged, including those with no results; errors are not. Storage, retention and
`MARIAN_KNOWS_NO_LOG`: [Finding gaps](../../guides/finding-gaps.md#where-the-log-lives).
