---
title: serve command
tags: [reference, cli, mcp, http]
---

# serve

```
marian-knows serve [--http [--port <n>] [--host <addr>]]
```

Runs the read-only MCP server with the tools `search`, `get`, `list`, `tags` and `status`
([MCP tools](../mcp-tools.md)).

- Default transport: stdio, for a local agent that starts the server itself. No token.
- `--http`: Streamable HTTP at `/mcp`, bearer token required. `--port` default 3000 (`0` = any free port),
  `--host` default `127.0.0.1` (`0.0.0.0` = all interfaces).

## Index refresh

The server runs what [`index`](index.md) does, git step included, in the background: at start, then every
`sync` minutes (default 15). Tools answer from the previous index meanwhile. On the very first start without an
index, tools return the missing-index error until the first run ends.

stderr shows the start run always, later runs only when something changed or warned. A busy lock
(`! warning: index refresh skipped: …`) or a git error (`! warning: index refresh failed: …`) never stops the
server; the next run tries again.

## Shutdown

On SIGINT or SIGTERM the server stops taking connections, waits up to 8 s for running tool calls and a running
refresh, then exits. Over stdio a session also ends when the client closes stdin.

Setup guides: [Connect an agent](../../getting-started/connect-an-agent.md), [Serve over HTTP](../../guides/serve-over-http.md).
