---
title: Exit codes
tags: [reference, cli]
---

# Exit codes

| Code | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | OK                                                                                               |
| 1    | No results from `search`, `list`, `tags` or `log`, or no tokens in `token list` (like `grep`)    |
| 2    | Error                                                                                            |

Code 2 covers: a missing or invalid config, invalid YAML, an invalid virtual path, an unknown anchor, a missing
index, bad arguments (unknown option, extra argument), `index` already running, a tokens file or `token` error,
a newly generated deploy key, a failed first git clone, and any unexpected failure.

A missing index prints `No index. Run: marian-knows index`. `status` and `destroy` treat a missing index as
code 0.
