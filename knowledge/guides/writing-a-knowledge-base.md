---
title: Writing a good knowledge base
tags: [guide, search, index]
---

# Writing a good knowledge base

Search ranks sections, not files, and weighs where a word appears: title 10, tags 5, section heading 5, body 1.
The way you write files decides what an agent finds. How ranking works: [How search works](../concepts/how-search-works.md).

## One topic per file

A file titled "Restore a backup" beats a section about restores buried in a 2000-line `operations.md`: the title
weight applies to every section of the file. Prefer many small files with precise names over a few large ones.

## Title and tags in frontmatter

```markdown
---
title: Restore a PostgreSQL backup
tags: [ops, postgres, backup]
---
```

- Title comes from `title`, then the first H1, then the file name.
- `tags` is a list or a comma-separated string. Tags let agents filter (`--tag ops`), and the `tags` tool tells
  them which values exist. Keep the set small and consistent; tags group case-insensitively.
- Frontmatter must start on the first line with `---`. A broken one is a warning and the file is indexed
  without metadata.

## Headings make sections

H2 and H3 split a file into sections; H4 and below stay inside their parent. Each section gets an anchor, and
agents read `/file.md#anchor` instead of the whole file. Write headings that say what the section answers:
"Restore to a new server" ranks and reads better than "Step 3".

Very short sections (under 200 characters) merge into the previous one; long ones (over 2000) split on
paragraphs. Details: [Sections and anchors](../concepts/sections-and-anchors.md).

## Use the words people ask with

Search is full-text, not semantic. A page about "time off" will not match the query "vacation" unless the word
appears in it. Put the synonyms and the other language in the text, a heading or a tag: "Vacation and time off
(urlop)". The query log shows which questions found nothing: [Finding gaps](finding-gaps.md).

## Write the description for the agent

The config's `description` is the first thing a connected agent reads about the base. Say what it holds, in
which language, and when to check it. See [Connect an agent](../getting-started/connect-an-agent.md#make-the-agent-use-it).

## Check how a file splits

```bash
marian-knows parse docs/ops/restore.md          # title, tags, sections with a preview
marian-knows parse docs/ops/restore.md --json
```

`parse` takes a disk path and needs no config or index.
