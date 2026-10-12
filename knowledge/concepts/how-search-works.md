---
title: How search works
tags: [concept, search]
---

# How search works

Full-text search on SQLite FTS5, tuned for Polish and English. Not semantic: a query matches words that appear
in the text, not their meaning.

## Ranking

- Sections are ranked with `bm25`. Weights: title 10, tags 5, section heading 5, body 1.
- Results are files: a file's position is the position of its best section.
- `score` in JSON output is the `bm25` value, lower is better, comparable only within one query.

## AND first, then OR

All words must match (AND). When that gives fewer than 3 results and the query has more than one meaningful
word, results matching any word (OR) are appended below the strict ones.

## Polish inflection without a stemmer

Words longer than 4 letters lose their last 2 letters, keeping at least 4, and match as a prefix:
`konfiguracja` finds "konfiguracji", `biura` (as `biur*`) finds "biuro". Words of up to 4 letters match as a
prefix without trimming.

## Diacritics

Diacritics are ignored: `zolw` finds "żółw". `ł` is folded to `l` too, which the tokenizer alone does not do.
Snippets and `get` keep the original text.

## Stop words

A built-in list of common Polish and English words is dropped from the query, question words included (`ile`,
`kto`, `should`), since agents often ask full questions. If only stop words would remain, nothing is dropped.

## Exact mode

`--exact` (MCP: `exact: true`) turns off trimming, prefix matching and the OR fallback. Use it for identifiers
such as `pg_restore`. FTS5 special characters are always removed from the query.

## What it cannot do

When a query shares no word with the page, the page is not found: a synonym ("vacation" vs "time off") or the
other language. Fix it in the content: [Writing a good knowledge base](../guides/writing-a-knowledge-base.md#use-the-words-people-ask-with).
The query log shows such misses: [Finding gaps](../guides/finding-gaps.md).

## Measured quality

The repository has quality sets with expected hits, run in `npm test`: keyword queries (hit@5 100%, MRR about
0.95) and agent-style questions (hit@5 about 91%). Weights, the fallback threshold and section sizes barely
moved the numbers when tuned; word trimming was the one real lever.
