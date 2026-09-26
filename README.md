# MarianKnows

Markdown knowledge base with full-text search (SQLite FTS5). CLI first, MCP later.

The `.md` files are the source of truth; the SQLite index is a disposable derivative.
Full requirements: [docs/requirements.md](docs/requirements.md) (Polish). Plan: [docs/roadmap.md](docs/roadmap.md).

## Status

Stage 1: config, source scanning and `init`. No index yet; `parse`, `index`, `search`, `list`, `get`,
`status` and `destroy` are recognised but only print `TODO: implementacja`.

## Config

One `marian-knows.yml` describes one project with one source directory:

```yaml
name: Customer knowledge base   # required
path: ./docs                    # optional, relative to this file; defaults to its directory
exclude:                        # optional, globs relative to path
  - "**/draft/**"
```

Scanning is recursive and picks up `.md` files only. Hidden entries and `node_modules` are always skipped.
A file's virtual path is its path relative to `path`: `docs/api/readme.md` becomes `/api/readme.md`.

## Usage

```bash
npm install
npm run dev -- init "My project"    # creates ./marian-knows.yml (never overwrites)
npm run dev -- scan                 # virtual paths from ./marian-knows.yml
npm run dev -- scan --disk          # virtual path <TAB> disk path (diagnostic)
npm run dev -- scan --json
npm run dev -- scan --config path/to/marian-knows.yml
npm run dev -- help
```

Config lookup: `--config`, then `MARIAN_KNOWS_CONFIG`, then `marian-knows.yml` searched upwards from the current directory.
`init` writes to `--config` if given, otherwise `./marian-knows.yml`.

## Development

```bash
npm test          # vitest
npm run typecheck
npm run build
```
