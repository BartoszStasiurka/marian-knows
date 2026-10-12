---
title: parse command
tags: [reference, cli, index]
---

# parse

```
marian-knows parse <file> [--json]
```

Parser diagnostics for one Markdown file given by **disk path**. Needs no config and no index.

- Default output: title, tags, frontmatter and the list of sections with a preview of each.
- `--json`: one object `{title, tags, frontmatter, sections}`.
- Warnings (broken frontmatter, bad `title` or `tags` type) go to stderr. An unreadable file is exit code 2.

Use it to see how headings become sections and anchors: [Sections and anchors](../../concepts/sections-and-anchors.md).
