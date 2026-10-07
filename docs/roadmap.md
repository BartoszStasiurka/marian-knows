# Roadmap

Each stage ends runnable, tested, and open to corrections. One checkbox is roughly one small commit.
Behavior details live in `docs/requirements.md`.

## 1. Config and scan (done)

- [x] Parse `marian-knows.yml` (`name`, `path`, `exclude`) with zod
- [x] Collect all validation errors at once, exit code 2
- [x] Reject unknown fields; separate message for legacy `sources`
- [x] Config lookup: `--config`, `MARIAN_KNOWS_CONFIG`, then search upward
- [x] Scan: `.md` only, skip hidden files, `node_modules`, `exclude` globs
- [x] Skip files over 1 MB and names with `#` or `?`, with a warning
- [x] Virtual paths (`/`, NFC), case-collision resolution
- [x] Missing source dir is a warning, not an error
- [x] `scan` command with `--json` and `--disk`
- [x] `init <project_name>` (never overwrites, no DB, no `.gitignore`)
- [x] `help` / `--help`
- [x] Stubs for later commands (`TODO: implementacja` on stderr, exit 0)

## 2. Parser (done)

Pure functions, no DB.

- [x] Read file: UTF-8, strip BOM, normalize CRLF and NFC
- [x] Frontmatter extraction (`yaml`), whole frontmatter kept as JSON
- [x] Broken frontmatter: no metadata, warning, body still parsed
- [x] Tags from `tags` (string or list)
- [x] Title: `title` from frontmatter, then first H1, then file name
- [x] Detect fenced code blocks so headings inside them are ignored
- [x] Split into sections on H2/H3; H4+ stays in the parent section
- [x] Section 0 for text before the first heading; no headings = one section
- [x] Anchors: slug from heading, unique per file (`backup`, `backup-1`)
- [x] Merge sections shorter than 200 chars into the previous one
- [x] Split sections longer than 2000 chars on paragraph boundaries
- [x] `parse <file>` command: human-readable output
- [x] `parse <file> --json`

## 3. Index (done)

- [x] Ask about and add `better-sqlite3`
- [x] DB location: `.marian-knows/index.db` next to the config (create the directory on first index), WAL mode
- [x] Schema: `meta`, `docs`, `sections`, `sections_fts` (`unicode61 remove_diacritics 2`)
- [x] Store `schema_version` and `indexed_at` in `meta`
- [x] Full rebuild: scan → parse → insert in one transaction
- [x] Unreadable file: warning, continue
- [x] `index` command with summary output (file count, +/~/-, time, warnings)
- [x] Test: index contains virtual paths only

## 4. Incremental sync (done)

- [x] Diff file set against `docs`: new, deleted, possibly changed (`mtime` / `size`)
- [x] Hash possibly changed files; same hash = update `mtime` only
- [x] Changed hash: re-index all sections of the file
- [x] Deleted and newly excluded files are removed
- [x] Whole sync in one transaction
- [x] Lock against parallel `index` runs
- [x] `schema_version` mismatch triggers a full rebuild
- [x] `index --full`

## 5. Search (done)

- [x] Basic FTS5 query over sections, `bm25` with weights (title 10, tags 5, heading 5, body 1)
- [x] Group by file: rank by best section, return its anchor
- [x] Strip FTS5 special characters from the query
- [x] Fold `ł`/`Ł` to `l`/`L`. The `unicode61 remove_diacritics 2` tokenizer strips only letters with a Unicode
  decomposition (ą ć ę ń ó ś ź ż), and `ł` has none, so `zolw` does not find `żółw` (only `zołw` does).
  - Fold the FTS columns (`title`, `heading`, `tags`, `body`) at index time and the query at search time;
    `docs` and `sections` keep the original text.
  - Snippets: the folding is one UTF-16 unit for one, so positions match. Run `highlight()` on the folded
    column and copy the markers onto `sections.body` at the same offsets, then trim to a snippet in code.
  - Bump `schema_version` (the stage 4 mismatch check rebuilds existing indexes).
  - Tests: `zolw` finds `żółw`, `lodz` finds `Łódź`, the snippet shows the original `ł`.
- [x] Stop words (built-in PL/EN list); keep all if only stop words remain
- [x] Prefix inflection: words > 5 chars lose 2 last letters, all matched as prefix
- [x] AND mode by default
- [x] OR fallback when < 3 results and > 1 meaningful word; strict results first
- [x] `--exact`: no trimming, no prefix, no fallback
- [x] `--tag` filter
- [x] Snippets with `[...]` highlights, `--snippets`
- [x] `-n <limit>`
- [x] `search` command: one path per line, exit 1 on no results (default limit 10; `--json` stays a stub until stage 6)
- [x] Missing index: `Brak indeksu. Uruchom: marian-knows index`, exit 2

## 6. Scope and inspection (done)

- [x] Virtual path syntax validator in core (`validateVirtualPath`)
- [x] Use it for `--path` / `--exclude-path` / `get`, exit 2 on invalid
- [x] `--path` prefix filter: trailing `/` = directory, otherwise single file
- [x] Repeatable `--path` (OR), `--exclude-path`
- [x] Scope applied before ranking and limit, AND with `--tag`
- [x] Valid scope with no files: warning on stderr, no results
- [x] `list` with `--tag`, `--path`, `--exclude-path`, sorted by path
- [x] `get <path>`: resolve to disk only inside the source dir
- [x] `status` (config, file and section counts, DB size, index time and age)
- [x] `destroy` (the `.marian-knows/` directory)
- [x] `--json` contract for `search`, `list`, `status` (bare array, `null` / `[]` for missing)
- [x] `--json`: stdout JSON only, warnings on stderr, `[]` + exit 1 on no results
- [x] Exit codes audit across all commands
- [x] One language for CLI messages: English everywhere (help, `index` summary, `! warning:`, `error:`,
  missing index); `docs/requirements.md` and the tests aligned.

## 7. Quality set (done)

- [x] Fixture knowledge base for quality tests
- [x] Queries file with expected hits
- [x] Top-5 hit-rate metric running in `npm test`
- [x] Tune weights, fallback threshold, stop words, section size limits
  - Only word trimming moved the numbers: trim 2 letters but keep at least 4 (5-letter words now trimmed too).
    hit@5 96.8% → 100%, MRR 0.922 → 0.946. Other parameters changed at most one query; kept as they were.

## 8. Polish (done)

- [x] `package.json`: `bin`, `exports` for `./core`, `files`; `prepack` does a clean build
- [x] Build check: `npm pack` and run the packed CLI
- [x] README: install, config, commands, JSON contract

## 9. Core for agents (done)

- [x] `getSection(path, anchor)` in core; `get` accepts `path#anchor`
- [x] `search --json`: add `heading` of the best section
- [x] Character limit on `get` output, with a truncation notice
  - 20000 chars by default, `--max-chars <n>` in the CLI (`0` = no limit); the notice lists the file's anchors.
- [x] Extend the quality set with ~20 agent-style queries (questions, synonyms); measure only, no tuning
  - `queries-agent.yml`, 23 queries: hit@5 91.3%, MRR 0.754 (keyword set: 100%, 0.946). Misses: a synonym
    ("Hiszpania" for "spoza Polski") and a Polish question about an English page.
- [x] Query log in core (`src/core/log.ts`), shared by CLI and MCP
  - `.marian-knows/logs/queries-YYYY-MM-DD.jsonl`, one file per day
  - Entry: `ts`, `source` (`cli` / `mcp`), `who` (`cli` or token name), `op` (`search` / `get` / `list`),
    query and filters, result count, top 5 virtual paths, duration in ms
  - No response content, no disk paths; a failed log write is a warning, never a command error
  - `MARIAN_KNOWS_NO_LOG=1` disables it (tests, scripts)
  - Files older than 90 days are deleted on write; `destroy` removes logs with the rest of `.marian-knows/`
- [x] `log [--zero] [--days N] [--json]` command; `--zero` = queries with no results

## 10. MCP over stdio

- [x] Ask about and add `@modelcontextprotocol/sdk`
- [x] `src/mcp.ts` entry point (same repo, thin adapter over core like `src/cli.ts`)
  - Started by `marian-knows serve` (stdio), one bin; `--http` comes in stage 12
- [x] Tools: `search`, `get` (file or `path#anchor`), `list`, `status`; virtual paths only
- [x] Tool descriptions written for the model: 2-4 keywords per query, retry with synonyms, read sections by anchor
- [x] Tests: SDK client against a temp-dir knowledge base
- [ ] Manual check: connect to Claude Code and query a real knowledge base
  - Found: the agent did not know when to use the server. Fixed with `description` (below).
- [x] Optional `description` in the config, written for the agent: first in the server instructions and the
  `search` description, also in `status`
- [x] Index directory per config: `.marian-knows/<config name>/`, so several configs share a directory;
  `destroy` removes only its own; an old `.marian-knows/index.db` gets a warning

## 11. Search quality for agents

- [x] Tune for long natural-language queries (OR fallback threshold, question stop words), measured on the stage 9 set
  - PL/EN question and helper words added to the stop words (`ile`, `kto`, `mogę`, `they`, `should`…; not
    quantifiers: "how many" matches "Too Many Requests"). Agent set MRR 0.754 → 0.757, keyword set 0.946 → 0.954.
  - No effect or worse, kept as they were: fallback threshold 2-10 (long questions never pass the strict AND),
    separate bm25 weights for the OR fallback (lower title weight: MRR down to 0.71), ranking OR results by the
    number of matched words (MRR down to 0.74).
  - Floors for the agent set in `quality.test.ts`: hit@5 0.91, MRR 0.75; keyword set MRR floor 0.94 → 0.95.
- [x] Decide with numbers whether FTS is enough or semantic search goes on the roadmap
  - FTS stays. Agent set hit@5 91.3% (21/23) on raw questions; both misses share no word with their page
    (synonym "Hiszpanii" for "spoza Polski", Polish question about an English page), which no FTS tuning fixes.
    Over MCP the agent writes the query itself, and the tool descriptions tell it to retry with synonyms.
  - Revisit when `log --zero` from real MCP use shows such misses often; semantic search stays under "Later".
- [ ] Manual check with a real agent over MCP (Claude Code): ask the `queries-agent.yml` questions in natural
  language, see whether the agent finds the expected file (rewriting queries, retrying with synonyms, reading
  sections by anchor), and compare with the raw FTS numbers above; then check `log` for what it actually sent

## 12. HTTP transport and auth

- [ ] Streamable HTTP: `serve --http --port <n>`
- [ ] Per-person opaque tokens, `Authorization: Bearer` (logic in `src/core/tokens.ts`, no new deps)
  - `token add <name>`: `mk_` + 32 random bytes (base64url), printed once; only SHA-256, name and date stored
  - `token list`: names, dates, last use; never the tokens
  - `token revoke <name>`: rejected from the next request on
  - `<config name>.tokens.json` next to the config (outside `.marian-knows/`, so `destroy` does not
    revoke everyone), git-ignored; `MARIAN_KNOWS_TOKENS` overrides the path
  - Hash comparison with `timingSafeEqual`
- [ ] Query log `who` = token name; rejected requests (401) go to `access-YYYY-MM-DD.jsonl`
- [ ] Rate limit per token

## 13. Index freshness

- [ ] `syncIndex` on server start and every N minutes (WAL keeps reads working)
- [ ] Optional webhook endpoint with a secret to force a sync after `git push`

## 14. Deploy

- [ ] Dockerfile (native `better-sqlite3` built in the image), volumes for the knowledge repo and `.marian-knows/`
- [ ] HTTPS via reverse proxy, healthcheck
- [ ] Connection guide: Claude Code, Claude Desktop / claude.ai, custom Agent SDK agents

## Later (not planned)

Public/internal split, multiple knowledge bases per server, OAuth (JWT issued by an auth server),
semantic search (only if stage 11 shows the need), writing through MCP.
