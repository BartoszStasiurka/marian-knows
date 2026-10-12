---
title: Finding gaps with the query log
tags: [guide, logs, search]
---

# Finding gaps with the query log

Every `search`, `get`, `list` and `tags` call, from the CLI or from an agent, is logged. Queries with no
results are the list of what your knowledge base is missing.

## Queries with no results

```bash
marian-knows log --zero              # last 7 days, no-result queries only
marian-knows log --zero --days 30
```

For each one, decide: is the knowledge missing (write a page), or is it there under other words (add the
synonym to the text, a heading or a tag)? See [Writing a good knowledge base](writing-a-knowledge-base.md#use-the-words-people-ask-with).

## Who asked what

```bash
marian-knows log                     # last 7 days, oldest first, sessions included
marian-knows log --json
```

Each line shows the UTC time, who (`cli`, `local` for stdio MCP, or the token name over HTTP), the operation,
the number of results, the query and its filters. MCP sessions appear as `connect` (with the client name and
version) and `disconnect` (with the number of tool calls and the session length).

## Where the log lives

`.marian-knows/<config name>/logs/queries-YYYY-MM-DD.jsonl`, one JSON object per line, one file per UTC day.

- No response content and no disk paths: query, filters, result count, top 5 virtual paths, duration.
- Files older than 90 days are deleted on write: queries can contain personal data.
- `MARIAN_KNOWS_NO_LOG=1` turns the query log off. `destroy` removes it with the index.

Field list: [log](../reference/commands/log.md).
