---
title: get command
tags: [reference, cli]
---

# get

```
marian-knows get <path>[#anchor] [--max-chars <n>]
```

Prints an indexed file by virtual path, unchanged (the bytes on disk), or one section of it.

- `get /a.md#backup` prints the section with that anchor: its heading line and every part of it. The first `#`
  starts the anchor.
- An unknown or empty anchor is an error that lists the anchors the file has.
- Only files present in the index can be read, inside the source directory: nothing `list` does not show.
- A path with a trailing `/`, a path outside the index, or a file deleted since indexing: exit code 2.

## Output cap

Output is capped at 20000 characters. The cut falls on the last line end in the second half of the limit. A
cut ends with a `[truncated: showed N of M characters. …]` notice; for a whole file it lists up to 50 anchors so
the next call can read one section. `--max-chars <n>` changes the cap, `0` turns it off.

See [Sections and anchors](../../concepts/sections-and-anchors.md).
