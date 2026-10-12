---
title: Virtual paths
tags: [concept, config, search]
---

# Virtual paths

Every file is addressed by its path relative to the knowledge base directory, starting with `/`. With
`path: ./docs`, the disk file `docs/api/readme.md` is `/api/readme.md`. With a [git source](../guides/git-source.md),
paths start at `git.path`.

## Why virtual

The index, the CLI output and the MCP tools contain virtual paths only. Disk paths appear in the YAML config
and in diagnostics (`scan --disk`, `status`), nowhere else. The index is portable, and an agent never learns
where the files sit on the server.

## Syntax

- Starts with `/`, separator `/`, Unicode NFC.
- No empty segments (`//`), no `.` or `..` segments, no `\`, no control characters, no whitespace at the edges
  of a segment; at most 512 characters.
- An invalid path is an error (exit code 2). A valid path with no indexed files gives no results (exit code 1)
  and a warning, e.g. `no indexed files under /nope/`.

## Scoping a query

`search`, `list` and `tags` take `--path` and `--exclude-path` (MCP: `path` and `excludePath` arrays):

- A trailing `/` means a directory at any depth: `/proj/A/` covers `/proj/A/x/y.md` but not `/proj/AB/z.md`.
- Without a trailing `/` it is one file.
- `--path` values are OR-ed, `--exclude-path` removes subtrees or files, and both combine with `--tag` by AND.
- Filters apply before ranking and the limit, so `-n 5` means five results within the scope.

```bash
marian-knows search deploy --path /server/ --exclude-path /server/old/
marian-knows list --path /hr/ --path /office/
```

## Case collisions

Two paths that differ only by case (`/Notes/x.md` and `/notes/x.md`, also in directory names): the first in
code-point order wins, the others are skipped with a warning.
