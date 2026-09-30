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

## 7. Quality set

- [ ] Fixture knowledge base for quality tests
- [ ] Queries file with expected hits
- [ ] Top-5 hit-rate metric running in `npm test`
- [ ] Tune weights, fallback threshold, stop words, section size limits

## 8. Polish

- [ ] `package.json`: `bin`, `exports` for `./core`, `files`
- [ ] Build check: `npm pack` and run the packed CLI
- [ ] README: install, config, commands, JSON contract

MCP is a separate later project.
