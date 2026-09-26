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

## 2. Parser

Pure functions, no DB.

- [ ] Read file: UTF-8, strip BOM, normalize CRLF and NFC
- [ ] Frontmatter extraction (`yaml`), whole frontmatter kept as JSON
- [ ] Broken frontmatter: no metadata, warning, body still parsed
- [ ] Tags from `tags` (string or list)
- [ ] Title: `title` from frontmatter, then first H1, then file name
- [ ] Detect fenced code blocks so headings inside them are ignored
- [ ] Split into sections on H2/H3; H4+ stays in the parent section
- [ ] Section 0 for text before the first heading; no headings = one section
- [ ] Anchors: slug from heading, unique per file (`backup`, `backup-1`)
- [ ] Merge sections shorter than 200 chars into the previous one
- [ ] Split sections longer than 2000 chars on paragraph boundaries
- [ ] `parse <file>` command: human-readable output
- [ ] `parse <file> --json`

## 3. Index

- [ ] Ask about and add `better-sqlite3`
- [ ] DB location: `marian-knows.db` next to the config, WAL mode
- [ ] Schema: `meta`, `docs`, `sections`, `sections_fts` (`unicode61 remove_diacritics 2`)
- [ ] Store `schema_version` and `indexed_at` in `meta`
- [ ] Full rebuild: scan → parse → insert in one transaction
- [ ] Unreadable file: warning, continue
- [ ] `index` command with summary output (file count, +/~/-, time, warnings)
- [ ] Test: index contains virtual paths only

## 4. Incremental sync

- [ ] Diff file set against `docs`: new, deleted, possibly changed (`mtime` / `size`)
- [ ] Hash possibly changed files; same hash = update `mtime` only
- [ ] Changed hash: re-index all sections of the file
- [ ] Deleted and newly excluded files are removed
- [ ] Whole sync in one transaction
- [ ] Lock against parallel `index` runs
- [ ] `schema_version` mismatch triggers a full rebuild
- [ ] `index --full`

## 5. Search

- [ ] Basic FTS5 query over sections, `bm25` with weights (title 10, tags 5, heading 5, body 1)
- [ ] Group by file: rank by best section, return its anchor
- [ ] Strip FTS5 special characters from the query
- [ ] Stop words (built-in PL/EN list); keep all if only stop words remain
- [ ] Prefix inflection: words > 5 chars lose 2 last letters, all matched as prefix
- [ ] AND mode by default
- [ ] OR fallback when < 3 results and > 1 meaningful word; strict results first
- [ ] `--exact`: no trimming, no prefix, no fallback
- [ ] `--tag` filter
- [ ] Snippets with `[...]` highlights, `--snippets`
- [ ] `-n <limit>`
- [ ] `search` command: one path per line, exit 1 on no results
- [ ] Missing index: `Brak indeksu. Uruchom: marian-knows index`, exit 2

## 6. Scope and inspection

- [x] Virtual path syntax validator in core (`validateVirtualPath`)
- [ ] Use it for `--path` / `--exclude-path` / `get`, exit 2 on invalid
- [ ] `--path` prefix filter: trailing `/` = directory, otherwise single file
- [ ] Repeatable `--path` (OR), `--exclude-path`
- [ ] Scope applied before ranking and limit, AND with `--tag`
- [ ] Valid scope with no files: warning on stderr, no results
- [ ] `list` with `--tag`, `--path`, `--exclude-path`, sorted by path
- [ ] `get <path>`: resolve to disk only inside the source dir
- [ ] `status` (config, file and section counts, DB size, index time and age)
- [ ] `destroy` (DB, `-wal`, `-shm`)
- [ ] `--json` contract for `search`, `list`, `status` (bare array, `null` / `[]` for missing)
- [ ] `--json`: stdout JSON only, warnings on stderr, `[]` + exit 1 on no results
- [ ] Exit codes audit across all commands

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
