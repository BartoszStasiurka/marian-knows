# MarianKnows

Markdown knowledge base, full-text search on SQLite FTS5, CLI command `marian-knows`.
Node.js 20+, ESM, TypeScript strict. Full spec: `docs/requirements.md` (Polish, source of truth for behavior).

## Rules

- Work stage by stage, see `docs/roadmap.md`. Implement only the current stage. Do not add features from later stages.
- Code, comments, docs, commit messages: English. Talk to the user in Polish.
- All logic lives in `src/core/`. `src/cli.ts` only parses arguments and formats output.
- Index and CLI output contain virtual paths only. Disk paths exist only in the YAML config and in diagnostic output (`scan --disk`).
- Ask before adding a dependency. Current deps: `yaml`, `zod`, `fast-glob`.
- Config file name: `marian-knows.yml`. Env: `MARIAN_KNOWS_CONFIG`. DB: `marian-knows.db` next to the config.
- Tests use temp dirs (`test/helpers.ts`), never real user paths.

## Commands

- `npm test`: run vitest
- `npm run typecheck`
- `npm run build`
- `npm run dev -- scan`: run the CLI from source

## Before every commit

`npm run typecheck && npm test` must pass. Small commits, one concern each, imperative mood ("Add mount overlap resolution").
