# MarianKnows

Markdown knowledge base with full-text search (SQLite FTS5). CLI first, MCP over stdio or HTTP, so AI agents
search the same base you do.

The `.md` files are the source of truth; the SQLite index is a disposable derivative you can delete and rebuild
at any time.

## Documentation

Two ways:

- **Read it** in [`knowledge/`](knowledge/README.md).
- **Ask your agent.** `knowledge/` is itself a MarianKnows knowledge base. Connect your agent over MCP and
  Marian already knows:

  ```yaml
  # marian-docs.yml
  name: MarianKnows docs
  description: Documentation of MarianKnows (CLI and MCP server). Check here before answering how to use it.
  path: ./marian-knows-docs
  git:
    url: https://github.com/BartoszStasiurka/marian-knows.git
    path: knowledge
  ```

  ```bash
  claude mcp add marian-docs -- marian-knows serve --config /path/to/marian-docs.yml
  ```

  Details: [Ask Marian about itself](knowledge/getting-started/connect-an-agent.md#ask-marian-about-itself).

## Install

Requires Node.js 20+. Not on the npm registry yet; install from a checkout:

```bash
git clone https://github.com/BartoszStasiurka/marian-knows.git && cd marian-knows
npm install
npm run build
npm link                 # puts `marian-knows` on PATH
```

Tarball, native module notes and Docker: [Install](knowledge/getting-started/install.md).

## Quick start

```bash
cd ~/notes
marian-knows init "My notes"     # creates ./marian-knows.yml (never overwrites)
marian-knows index               # builds .marian-knows/marian-knows/index.db next to the config
marian-knows search backup postgres --snippets
marian-knows get /ops/backup.md#restore   # one section, by the anchor search returned
claude mcp add kb -- marian-knows serve --config ~/notes/marian-knows.yml
```

Add `.marian-knows/` to your `.gitignore`. Next steps: [Quick start](knowledge/getting-started/quick-start.md),
[Config reference](knowledge/reference/config.md), [Commands](knowledge/reference/commands/README.md).

## Development

```bash
npm test                  # vitest, including the search quality sets (hit@5, MRR)
npm run typecheck
npm run build
npm run dev -- search x   # run the CLI from source
npx tsx test/quality.ts   # quality report without vitest
```

Behavior spec (Polish): [docs/requirements.md](docs/requirements.md). Plan: [docs/roadmap.md](docs/roadmap.md).
A behavior change updates `knowledge/` in the same commit.
