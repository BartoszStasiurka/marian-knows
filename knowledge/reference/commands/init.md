---
title: init command
tags: [reference, cli, config]
---

# init

```
marian-knows init <project_name> [--config <file>]
```

Creates a minimal config with only `name`. The name follows the rules of the `name` field (1-128 characters,
no control characters).

- Default target: `./marian-knows.yml`; `--config` picks another file.
- An existing file is never overwritten (exit code 2).
- Does not touch `.gitignore` and creates no index. Add `.marian-knows/` to `.gitignore` yourself.

Next: edit the config ([Config reference](../config.md)) and run [`index`](index.md).
