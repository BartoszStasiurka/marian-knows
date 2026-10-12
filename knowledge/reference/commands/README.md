---
title: Commands
tags: [reference, cli]
---

# Commands

```
marian-knows <command> [options]
```

| Command                          | What it does                                                          |
| -------------------------------- | --------------------------------------------------------------------- |
| [`init`](init.md)                | Create a minimal `marian-knows.yml` (never overwrites)                |
| [`scan`](scan.md)                | List files the index would contain, without indexing                  |
| [`parse`](parse.md)              | Show how a Markdown file splits into sections; no config needed       |
| [`index`](index.md)              | Pull the git source if configured, then sync the index                |
| [`search`](search.md)            | Files ranked by relevance                                             |
| [`list`](list.md)                | Indexed files sorted by path                                          |
| [`tags`](tags.md)                | Tags, most common first                                               |
| [`get`](get.md)                  | Print an indexed file, or one section of it                           |
| [`status`](status.md)            | Project, config and index state                                       |
| [`destroy`](destroy.md)          | Remove this config's index and logs                                   |
| [`log`](log.md)                  | Show the query log and MCP sessions                                   |
| [`serve`](serve.md)              | Run the MCP server over stdio or HTTP                                 |
| [`token`](token.md)              | Manage HTTP access tokens                                             |
| `help`                           | Show help (also `--help`, `-h`)                                       |

## Global option

`--config <file>` picks the config. Without it: `MARIAN_KNOWS_CONFIG`, then `marian-knows.yml` searched upwards
from the current directory. For `init` it is the file to create.

## Output conventions

- Messages are in English. Warnings start with `! warning:`, errors with `error:`, both on stderr.
- Default output is one virtual path per line.
- With `--json`, stdout carries JSON only. See [JSON output](../json-output.md).
- Exit codes: 0 OK, 1 no results, 2 error. See [Exit codes](../exit-codes.md).
