---
title: Serve over HTTP
tags: [guide, mcp, http, security]
---

# Serve over HTTP

`marian-knows serve --http` serves the MCP tools over Streamable HTTP at `/mcp`, for agents on other machines
or for a whole team. Every request needs a bearer token.

## Create tokens

One token per person or agent, so the query log shows who asked and you can revoke one without touching the
others.

```bash
marian-knows token add anna      # prints mk_… once; pass it on over a safe channel
marian-knows token list          # names, creation and last use; never the tokens
marian-knows token revoke anna   # rejected from the server's next request on
```

- Only the SHA-256 of a token is stored, in `<config name>.tokens.json` next to the config
  (`marian-knows.yml` → `marian-knows.tokens.json`). `MARIAN_KNOWS_TOKENS` overrides the path.
- The file is outside `.marian-knows/`, so `destroy` revokes nobody. Add it to `.gitignore` and back it up:
  it is the only state that cannot be rebuilt.
- The server re-reads the file when it changes: `add` and `revoke` need no restart, and a revoke applies inside
  open sessions too.

## Start the server

```bash
marian-knows serve --http                   # 127.0.0.1:3000
marian-knows serve --http --port 8080
marian-knows serve --http --host 0.0.0.0    # all interfaces, e.g. inside a container
```

`--port 0` picks a free port. The endpoint address goes to stderr. Other paths than `/mcp` return 404.

## Connect a client

```bash
claude mcp add --transport http kb https://kb.example.com/mcp --header "Authorization: Bearer mk_…"
```

A request without a valid `Authorization: Bearer <token>` header gets 401.

## Put HTTPS in front

The server speaks plain HTTP. Before it leaves localhost, put a reverse proxy with TLS in front. Caddy gets the
certificate by itself:

```
kb.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

In nginx: `location /mcp { proxy_pass http://127.0.0.1:3000; }` plus a certificate as for any site.

## Sessions

- A session (`Mcp-Session-Id`) belongs to the token that opened it; another token gets 404.
- A session ends on `DELETE` or after 30 minutes without requests; the client then opens a new one.
- On SIGINT or SIGTERM the server stops taking connections, waits up to 8 s for running tool calls and a
  running index refresh, closes the sessions and exits with 0. A second signal kills it at once.

## Logs

- Tool calls go to the query log with `who` set to the token name: `marian-knows log`. See
  [Finding gaps](finding-gaps.md).
- Rejected requests go to `.marian-knows/<config name>/logs/access-YYYY-MM-DD.jsonl`: time, reason (`missing`,
  `malformed`, `unknown`), peer address, `X-Forwarded-For`, method, path, user agent. Never the token. This log
  is written even with `MARIAN_KNOWS_NO_LOG`.

Who can read what, and why write access to the knowledge repo matters: [Security](../concepts/security.md).
