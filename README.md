# MarianKnows

Markdown knowledge base with full-text search (SQLite FTS5). CLI first, MCP later.

The `.md` files are the source of truth; the SQLite index is a disposable derivative.
Full requirements: [docs/requirements.md](docs/requirements.md) (Polish). Plan: [docs/roadmap.md](docs/roadmap.md).

## Status

Stage 1: config parsing and source scanning. No index yet.

## Usage

```bash
npm install
npm run dev -- scan                 # virtual paths from ./marian-knows.yml
npm run dev -- scan --disk          # virtual path <TAB> disk path (diagnostic)
npm run dev -- scan --json
npm run dev -- scan --config path/to/marian-knows.yml
```

Config lookup: `--config`, then `MARIAN_KNOWS_CONFIG`, then `marian-knows.yml` searched upwards from the current directory.

## Development

```bash
npm test          # vitest
npm run typecheck
npm run build
```
