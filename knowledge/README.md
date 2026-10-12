---
title: MarianKnows documentation
tags: [getting-started]
---

# MarianKnows documentation

MarianKnows turns a directory of Markdown files into a searchable knowledge base: full-text search on SQLite
FTS5, a CLI (`marian-knows`), and a read-only MCP server so AI agents can use the same base.

This directory is the product's own documentation, and it is itself a MarianKnows knowledge base. Read it here,
or connect your agent to it and ask: see [Connect an agent](getting-started/connect-an-agent.md#ask-marian-about-itself).

## Where to start

- New here: [Install](getting-started/install.md), then [Quick start](getting-started/quick-start.md).
- Giving an AI agent access: [Connect an agent](getting-started/connect-an-agent.md).
- Running it for a team: [Serve over HTTP](guides/serve-over-http.md) and [Docker](guides/docker.md).

## Layout

| Directory          | What it holds                                                          |
| ------------------ | ---------------------------------------------------------------------- |
| `getting-started/` | Install, first index, first agent connection                           |
| `guides/`          | Task-oriented how-tos: git source, HTTP, Docker, writing a good base   |
| `concepts/`        | How it works: virtual paths, sections and anchors, search, the index   |
| `reference/`       | Exact behavior: config fields, every command, MCP tools, JSON, exits   |
| `troubleshooting.md` | Error and warning messages, what they mean, what to do               |

Every file has a `title` and `tags` in its frontmatter. Tags name the type (`getting-started`, `guide`,
`concept`, `reference`, `troubleshooting`) and the area (`cli`, `config`, `search`, `index`, `mcp`, `http`,
`git`, `docker`, `security`, `logs`).
