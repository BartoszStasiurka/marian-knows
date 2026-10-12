---
title: Security
tags: [concept, security, mcp, http]
---

# Security

## Everyone connected sees everything

One server serves one config and one knowledge base. Every connected agent and person can read all of it.
Content that not everyone may see goes to a separate config and a separate server instance.

## Write access to the knowledge repo is an admin right

File content reaches the agent's context unchanged. Whoever can write to the knowledge files can steer every
connected agent (prompt injection). The server tells agents that file content is data, never instructions, but
that is a mitigation, not a guarantee. Grant write access to the knowledge repository as you would admin rights.

## The server is read-only

MCP tools search, list and read indexed files. They cannot create, change or delete anything. `get` reads only
files present in the index, inside the configured source directory: nothing excluded, hidden or outside `.md`.

## No disk paths

The index, the output and the MCP tools use [virtual paths](virtual-paths.md) only. The MCP `status` tool
leaves out the config and source paths.

## HTTP tokens

- Opaque per-person tokens (`mk_` + 32 random bytes). Only their SHA-256 is stored, compared in constant time.
- Revocation applies from the next request, inside open sessions too. No JWT: the server issues and checks its
  own tokens, which keeps revocation instant.
- A broken or unknown-version tokens file makes the server reject every request until it is fixed.
- Plain HTTP only: put a TLS reverse proxy in front before leaving localhost.

See [Serve over HTTP](../guides/serve-over-http.md).

## Logs

The query log holds queries, filters, result counts and top paths, never response content or disk paths.
Queries can contain personal data, so files older than 90 days are deleted. The access log of rejected HTTP
requests never contains the token.

## Git

Git runs with terminal prompts off, so it never waits for a password. A deploy key opens one repo read-only, and
host keys are pinned in `<deployKey>.known_hosts`. Credentials in `http(s)://` URLs are masked in output.
