---
title: tags command
tags: [reference, cli]
---

# tags

```
marian-knows tags [--counts] [--path <prefix>]... [--exclude-path <prefix>]... [--json]
```

Prints the tags of indexed files, one per line, most common first; equal counts sort by tag.

- `--counts` prints `<files>  <tag>`.
- Tags group case-insensitively, as `--tag` matches them. Each group shows its most common spelling (on a tie,
  the first alphabetically).
- `--path` and `--exclude-path` narrow the files counted, as in [`list`](list.md).
- `--json`: an array of names; with `--counts`, an array of `{tag, count}`.
- No tags: exit code 1. No index: exit code 2.

```
$ marian-knows tags --counts
12  ops
3  hr
```
