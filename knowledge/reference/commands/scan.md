---
title: scan command
tags: [reference, cli, config]
---

# scan

```
marian-knows scan [--json] [--disk]
```

Lists the files the index would contain, as virtual paths, without touching the index. A dry run for checking
`path` and `exclude`.

- `--disk` adds disk paths, for diagnostics only.
- `--json` prints an array.
- Warnings (missing directory, skipped files, case collisions) go to stderr.
- Never runs git: with a [git source](../../guides/git-source.md) it scans what is on disk.
