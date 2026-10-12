---
title: Environment variables
tags: [reference, config, logs, http]
---

# Environment variables

| Variable              | Effect                                                                                |
| --------------------- | ------------------------------------------------------------------------------------- |
| `MARIAN_KNOWS_CONFIG` | Config file to use when `--config` is not given; checked before searching upwards     |
| `MARIAN_KNOWS_NO_LOG` | Any non-empty value other than `0` turns off the query log; the HTTP access log stays |
| `MARIAN_KNOWS_TOKENS` | Path of the HTTP tokens file instead of `<config name>.tokens.json` next to the config |

The Docker image sets `MARIAN_KNOWS_CONFIG=/data/marian-knows.yml` and `PORT=3000`.

## Library

The core logic is importable from Node, for scripts and custom integrations:

```js
import { findConfig, loadConfig, syncIndex, search } from "marian-knows/core";
```

Only the `marian-knows/core` entry point is exported. Its API is not yet covered by the stability promise that
applies to the JSON output.
