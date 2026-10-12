---
title: token command
tags: [reference, cli, http, security]
---

# token

```
marian-knows token add <name>
marian-knows token list [--json]
marian-knows token revoke <name>
```

Manages access tokens for `serve --http`.

- `add <name>` generates `mk_` + 32 random bytes (base64url) and prints the token once: the token alone on
  stdout, the message on stderr. Names are unique and follow the rules of `name`; a duplicate is exit code 2.
- `list` shows names, creation and last use, never tokens. `--json`: an array of `{name, createdAt, lastUsedAt}`.
  No tokens: exit code 1.
- `revoke <name>` stops the token from the server's next request on, inside open sessions too. An unknown name
  is exit code 2.

The file is `<config name>.tokens.json` next to the config, or `MARIAN_KNOWS_TOKENS`. Last use is written at most
once a minute. A damaged file or an unknown file version makes `token` exit with 2.

See [Serve over HTTP](../../guides/serve-over-http.md#create-tokens).
