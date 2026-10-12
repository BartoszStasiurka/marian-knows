---
title: status command
tags: [reference, cli, index]
---

# status

```
marian-knows status [--json]
```

Shows the project name and description, the config and source paths (diagnostic), `exclude`, the index state,
file and section counts, index size, when it was indexed and how long ago, and the number of distinct tags.

- Index state: `ok`, `missing` or `outdated` (schema version differs; the next `index` rebuilds it).
- A missing index is not an error: exit code 0.
- Size counts `index.db` with its `-wal` and `-shm` files.

`--json` prints one object; fields in [JSON output](../json-output.md#status).
