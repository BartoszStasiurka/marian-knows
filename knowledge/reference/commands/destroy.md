---
title: destroy command
tags: [reference, cli, index]
---

# destroy

```
marian-knows destroy
```

Removes this config's `.marian-knows/<config name>/` directory: the index and the query and access logs.
`.marian-knows/` goes too, but only when it ends up empty; other configs' indexes stay.

- The config, the tokens file and the `.md` files stay. Nobody loses HTTP access.
- Refuses while `index` runs (exit code 2).
- No index: exit code 0 and `No index to remove`.

Run [`index`](index.md) to build a new one.
