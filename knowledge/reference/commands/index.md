---
title: index command
tags: [reference, cli, index, git]
---

# index

```
marian-knows index [--full]
```

Pulls the git source when the config has a `git` block, then syncs the index incrementally: only new, changed
and removed files are touched.

- `--full` rebuilds the index from scratch.
- The index lives in `.marian-knows/<config name>/index.db` next to the config.
- Output: the file count and `+ added, ~ changed, - removed (seconds)`, warnings on stderr, `git:` lines when
  git ran.
- Another `index` running on the same config: `index is already running (pid N)`, exit code 2.

```
$ marian-knows index
Files: 42
+ 42 added, ~ 0 changed, - 0 removed (0.4 s)
! warning: skipped /notes/x.md: name differs only by case from /Notes/x.md
```

How sync and the lock work: [Index lifecycle](../../concepts/index-lifecycle.md). The git step:
[Git source](../../guides/git-source.md).
