---
title: Index lifecycle
tags: [concept, index]
---

# Index lifecycle

The `.md` files are the source of truth. The SQLite index is a derivative you can delete and rebuild at any
time.

## Where it lives

`.marian-knows/<config file name without extension>/index.db` next to the config, with its WAL files, the
index lock and the logs. `marian-knows.yml` → `.marian-knows/marian-knows/`. The location cannot be changed.

One config is one index, so several configs can share a directory, e.g. `public.yml` and `internal.yml`, each
with its own index and logs. That is how public and internal content are kept apart.

## Incremental sync

`marian-knows index`:

1. Runs the [git step](../guides/git-source.md) when the config has a `git` block.
2. Scans the source directory.
3. Compares with the index: new paths, removed paths, and files with a different modification time or size.
4. Hashes the candidates: same hash only updates the time, a different hash re-indexes all sections of the file.

Removed or newly excluded files disappear, since the diff is on the set of paths. Everything runs in one
transaction: an error rolls back and the index stays as it was.

```
Files: 42
+ 42 added, ~ 0 changed, - 0 removed (0.4 s)
```

## Full rebuild

`marian-knows index --full` rebuilds from scratch. It also happens on its own when the index schema version
differs (a new parser, tokenizer or table layout), in both directions, so rolling back to an older version is
safe.

## While the server runs

`serve` does what `index` does in the background: at start, then every `sync` minutes (default 15) counted
from the end of the previous run, so runs never overlap. `sync: 0` refreshes only at start. Tools answer from
the previous index meanwhile. A failed refresh is a warning and the next run tries again.

## Concurrency

- WAL mode: searches work while `index` runs. SQLite in WAL mode needs a local disk, not NFS or SMB.
- An `index.lock` file with `hostname:pid` prevents parallel runs and covers the git step too. A second run
  fails with `index is already running (pid N)` (exit code 2); inside `serve` the refresh is skipped with a
  warning.
- A lock is abandoned and taken over when its process is dead, when it comes from another host, or when it has
  the current process's PID but this process does not hold it (a restarted container keeps hostname and PID).

## Removing it

`marian-knows destroy` removes this config's index and logs. The config, the tokens file and the `.md` files
stay. It refuses while `index` runs.
