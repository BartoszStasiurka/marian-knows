# Roadmap

Each stage ends runnable, tested, and open to corrections.

1. **Config and scan** (done): single-source `marian-knows.yml` (`name`, `path`, `exclude`) parsing and validation, `scan`, `init`, `help`, stubs for later commands.
2. **Parser**: frontmatter, title, tags, splitting into sections (H2/H3), anchors. Pure functions, no DB, `parse <file>` command (disk path).
3. **Index**: SQLite schema + FTS5, full rebuild, `index` command.
4. **Incremental sync**: file-set diff (mtime, size, hash), one transaction, lock, `schema_version`.
5. **Search**: bm25 weights, snippets, AND with OR fallback, stop words, prefix inflection, `--exact`, `--tag`.
6. **Scope and inspection**: `--path` / `--exclude-path`, `list`, `get`, `status`, `destroy`, `--json` contract, exit codes.
7. **Quality set**: queries with expected hits, top-5 metric, tuning of weights and thresholds.
8. **Polish**: packaging, README. MCP is a separate later project.
