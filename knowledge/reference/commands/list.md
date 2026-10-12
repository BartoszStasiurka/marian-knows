---
title: list command
tags: [reference, cli]
---

# list

```
marian-knows list [--tag <tag>] [--path <prefix>]... [--exclude-path <prefix>]... [--json]
```

Prints indexed files sorted by path, one virtual path per line. Takes the same filters as
[`search`](search.md). No files: exit code 1. No index: exit code 2.

`--json` prints an array of `{path, title, tags}`. See [JSON output](../json-output.md#search-and-list).
