---
title: Sections and anchors
tags: [concept, index, search]
---

# Sections and anchors

The index stores sections, not whole files. Search ranks sections, and `get` can return one section by its
anchor, so an agent reads the part that answers the question instead of a whole file.

## How a file splits

- H2 and H3 headings start sections. H1 is the document title; H4 and below stay in the parent section.
- Text before the first heading is section 0. A file without headings is one section.
- Only ATX headings count (`## Title`, up to 3 spaces of indent, a space after `#`). Setext headings
  (`===`, `---` underlines) are not recognized.
- Headings inside fenced code blocks (```` ``` ```` or `~~~`) are ignored. An unclosed block runs to the end of
  the file.
- Sections shorter than 200 characters merge into the previous one, heading line included. The first section
  of a file has nothing to merge with and stays.
- Sections longer than 2000 characters split on paragraph boundaries. A code block or a single paragraph longer
  than that is not cut.

Every section inherits the file's title and tags.

## Anchors

An anchor is a GitHub-style slug of the heading: lower case, punctuation removed, Polish letters kept,
whitespace turned into `-`. Duplicates get a suffix (`backup`, `backup-1`); an empty slug is `section`.

- Anchors are computed before merging, so a merge never shifts the other anchors. A merged short section has no
  anchor of its own.
- The parts of a split section share the heading and the anchor: the anchor is a link target.

## Reading a section

```bash
marian-knows get /ops/backup.md#restore
```

`get` parses the file at read time, so anchors match the current file on disk. It returns the heading line and
every part of the section. An unknown anchor is an error that lists the anchors the file has. `search --json`
returns each file's best section as `anchor` and `heading` (`null` for section 0).

## Inspecting a file

```bash
marian-knows parse docs/ops/backup.md
```

Shows the title, tags, frontmatter and every section with a preview. See [parse](../reference/commands/parse.md).
