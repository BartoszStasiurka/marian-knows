---
title: Connect an agent
tags: [getting-started, mcp]
---

# Connect an agent

`marian-knows serve` exposes the knowledge base to AI agents over MCP. The server is read-only: agents can
search, list and read files, never change them. Tools are described in [MCP tools](../reference/mcp-tools.md).

## Local agent over stdio

The agent's client starts the server as a subprocess. No token, no port.

```bash
claude mcp add kb -- marian-knows serve --config /path/to/marian-knows.yml
```

For other clients (Claude Desktop, Cursor, an Agent SDK agent) configure an stdio server with the command
`marian-knows` and the arguments `serve --config /path/to/marian-knows.yml`.

## Shared server over HTTP

One server for a team, each person with their own token:

```bash
marian-knows token add anna                  # prints mk_… once
marian-knows serve --http --port 3000
claude mcp add --transport http kb http://127.0.0.1:3000/mcp --header "Authorization: Bearer mk_…"
```

Tokens, HTTPS and logs: [Serve over HTTP](../guides/serve-over-http.md). Running it in a container:
[Docker](../guides/docker.md).

## Make the agent use it

The agent decides whether to search the base from the server instructions and the `search` tool description.
Both start with the config's `name` and `description`. Write `description` for the agent: what the base holds,
in which language, and when to check it.

```yaml
description: >
  Support procedures and product FAQ, in Polish. Check here before answering
  questions about orders, returns or shipping.
```

Without a description the agent only learns that some knowledge base exists and is told to call `list` to see
what it holds. A config change takes effect when the server restarts.

## Ask Marian about itself

This documentation is a MarianKnows knowledge base. Point a config at the repository and your agent can answer
questions about MarianKnows from it, with no clone of the code:

```yaml
name: MarianKnows docs
description: >
  Documentation of MarianKnows, a Markdown knowledge base with full-text search, CLI and MCP server.
  Check here before answering how to install, configure, index, search, serve over MCP or deploy it.
path: ./marian-knows-docs
git:
  url: https://github.com/BartoszStasiurka/marian-knows.git
  path: knowledge
```

```bash
claude mcp add marian-docs -- marian-knows serve --config /path/to/marian-docs.yml
```

The server clones only the `knowledge/` directory (sparse checkout) at start and pulls changes every 15
minutes. If you already have a checkout of the repository, the `marian-knows.yml` at its root serves the same
directory without git: `claude mcp add marian-docs -- marian-knows serve --config /path/to/marian-knows/marian-knows.yml`.
