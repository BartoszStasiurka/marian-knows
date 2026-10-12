---
title: Quick start
tags: [getting-started, cli, search]
---

# Quick start

From a directory of Markdown notes to search results in four commands.

## Create the config

```bash
cd ~/notes
marian-knows init "My notes"
```

`init` writes a minimal `marian-knows.yml` with just `name`. It never overwrites an existing file. With no
`path`, the knowledge base is the directory of the config. Point it somewhere else with `path: ./docs`; all
fields are in [Config reference](../reference/config.md).

Add a `description` now if an agent will use the base: it is how the agent decides whether to look here at all.

## Build the first index

```bash
marian-knows index
```

The first run creates the index; later runs only update it. The index goes to `.marian-knows/marian-knows/index.db` next to the config. Add `.marian-knows/` to your
`.gitignore`; `init` does not touch it. The index is disposable: delete it or run `index --full` any time.

## Search and read

```bash
marian-knows search backup postgres --snippets
marian-knows get /ops/backup.md
marian-knows get /ops/backup.md#restore   # one section, by the anchor search returned
```

Paths like `/ops/backup.md` are virtual: relative to the knowledge base directory, always starting with `/`.
See [Virtual paths](../concepts/virtual-paths.md) and [Sections and anchors](../concepts/sections-and-anchors.md).

## Keep it fresh

Run `marian-knows index` after you change files; it only re-reads files that changed. The MCP server refreshes
the index on its own. To pull the files from a git repository first, see [Git source](../guides/git-source.md).

## Next step

[Connect an agent](connect-an-agent.md) so Claude or another MCP client can search the base.
