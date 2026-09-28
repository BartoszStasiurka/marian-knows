import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_SECTION_CHARS,
  MIN_SECTION_CHARS,
  decodeMarkdown,
  parseFile,
  parseMarkdown,
  slugify,
} from "../src/core/index.js";
import { makeTree } from "./helpers.js";

/** Filler text of exactly n chars, no blank lines. */
const text = (n: number, ch = "a") => ch.repeat(n);
const long = text(MIN_SECTION_CHARS);

const headings = (md: string) => parseMarkdown(md, "f.md").sections.map((s) => s.heading);

describe("decodeMarkdown", () => {
  it("strips the BOM and normalizes CRLF, lone CR and NFC", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a\r\nb\rć", "utf8")]);
    expect(decodeMarkdown(bytes)).toBe("a\nb\nć".replace("ć", "ć".normalize("NFC")));
  });

  it("parseFile reads from disk and falls back to the file name for the title", () => {
    const dir = makeTree({ "notes/Zażółć.md": "﻿---\r\ntags: x\r\n---\r\nbody\r\n" });
    const doc = parseFile(path.join(dir, "notes", "Zażółć.md"));
    expect(doc.title).toBe("Zażółć");
    expect(doc.tags).toEqual(["x"]);
    expect(doc.sections).toEqual([{ ord: 0, level: null, heading: null, anchor: null, body: "body" }]);
  });
});

describe("frontmatter", () => {
  it("keeps the whole frontmatter and strips it from the body", () => {
    const doc = parseMarkdown("---\ntitle: T\nowner: ops\nn: 3\n---\nbody", "f.md");
    expect(doc.frontmatter).toEqual({ title: "T", owner: "ops", n: 3 });
    expect(doc.sections[0]!.body).toBe("body");
    expect(doc.warnings).toEqual([]);
  });

  it("accepts '...' as the closing delimiter and an empty frontmatter", () => {
    expect(parseMarkdown("---\na: 1\n...\nx", "f.md").frontmatter).toEqual({ a: 1 });
    expect(parseMarkdown("---\n---\nx", "f.md").frontmatter).toEqual({});
  });

  it("broken YAML: no metadata, a warning, body still parsed", () => {
    const doc = parseMarkdown("---\ntitle: [unclosed\ntags: a\n---\n# Heading\nbody", "f.md");
    expect(doc.frontmatter).toBeNull();
    expect(doc.tags).toEqual([]);
    expect(doc.title).toBe("Heading");
    expect(doc.sections[0]!.body).toBe("body");
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toMatch(/^broken frontmatter/);
  });

  it("a non-mapping frontmatter is broken", () => {
    const doc = parseMarkdown("---\n- a\n- b\n---\nbody", "f.md");
    expect(doc.frontmatter).toBeNull();
    expect(doc.warnings[0]).toMatch(/expected a mapping/);
  });

  it("an unclosed frontmatter is treated as body, with a warning", () => {
    const doc = parseMarkdown("---\ntitle: T\nbody", "f.md");
    expect(doc.frontmatter).toBeNull();
    expect(doc.title).toBe("f");
    expect(doc.sections[0]!.body).toBe("---\ntitle: T\nbody");
    expect(doc.warnings[0]).toMatch(/not closed/);
  });

  it("'---' later in the file is not frontmatter", () => {
    expect(parseMarkdown("x\n---\na: 1\n---\n", "f.md").frontmatter).toBeNull();
  });
});

describe("tags", () => {
  const tags = (yaml: string) => parseMarkdown(`---\n${yaml}\n---\n`, "f.md");

  it("reads a list", () => {
    expect(tags("tags: [ops, backup]").tags).toEqual(["ops", "backup"]);
  });

  it("splits a string on commas, trims, dedupes, drops empties", () => {
    expect(tags("tags: 'ops, backup,,ops '").tags).toEqual(["ops", "backup"]);
  });

  it("stringifies numbers in a list and skips other values", () => {
    expect(tags("tags: [2024, ops, {a: 1}, null]").tags).toEqual(["2024", "ops"]);
  });

  it("ignores other types with a warning", () => {
    const doc = tags("tags: {a: 1}");
    expect(doc.tags).toEqual([]);
    expect(doc.warnings).toEqual(["tags ignored: expected a string or a list"]);
  });

  it("no tags field gives an empty list", () => {
    expect(tags("title: T").tags).toEqual([]);
  });
});

describe("title", () => {
  it("prefers frontmatter title", () => {
    expect(parseMarkdown("---\ntitle: ' From FM '\n---\n# From H1", "f.md").title).toBe("From FM");
  });

  it("falls back to the first H1, then the file name", () => {
    expect(parseMarkdown("---\ntitle: ''\n---\n# From H1\n# Second", "f.md").title).toBe("From H1");
    expect(parseMarkdown("no headings", "dir/My Note.MD").title).toBe("My Note");
  });

  it("ignores an H1 inside a code block", () => {
    expect(parseMarkdown("```\n# not a title\n```\n", "real.md").title).toBe("real");
  });

  it("strips closing hashes from the H1", () => {
    expect(parseMarkdown("# Title ##", "f.md").title).toBe("Title");
  });

  it("warns on a non-scalar title", () => {
    const doc = parseMarkdown("---\ntitle: [a]\n---\n# H", "f.md");
    expect(doc.title).toBe("H");
    expect(doc.warnings).toEqual(["title ignored: expected a string"]);
  });
});

describe("sections", () => {
  it("splits on H2 and H3; H4+ stays in the parent section", () => {
    const md = `## A\n${long}\n### B\n${long}\n#### C\ninside B\n## D\n${long}`;
    const doc = parseMarkdown(md, "f.md");
    expect(doc.sections.map((s) => [s.ord, s.level, s.heading, s.anchor])).toEqual([
      [0, 2, "A", "a"],
      [1, 3, "B", "b"],
      [2, 2, "D", "d"],
    ]);
    expect(doc.sections[1]!.body).toBe(`${long}\n#### C\ninside B`);
  });

  it("text before the first heading is section 0; the title H1 is not part of it", () => {
    const doc = parseMarkdown(`# Title\n\nintro ${long}\n\n## A\n${long}`, "f.md");
    expect(doc.sections[0]).toEqual({ ord: 0, level: null, heading: null, anchor: null, body: `intro ${long}` });
    expect(doc.sections[1]!.heading).toBe("A");
  });

  it("no section 0 when there is no text before the first heading", () => {
    expect(headings(`# Title\n\n## A\n${long}`)).toEqual(["A"]);
  });

  it("a file without headings is one section", () => {
    const doc = parseMarkdown("just\n\ntext", "f.md");
    expect(doc.sections).toEqual([{ ord: 0, level: null, heading: null, anchor: null, body: "just\n\ntext" }]);
  });

  it("an empty file gives no sections", () => {
    expect(parseMarkdown("", "f.md").sections).toEqual([]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const md = `## A\n${long}\n\`\`\`sh\n## not a heading\n\`\`\`\n~~~~\n## nor this\n~~~\n## still not\n~~~~\n## B\n${long}`;
    expect(headings(md)).toEqual(["A", "B"]);
  });

  it("a longer closing fence closes, a shorter or different one does not", () => {
    expect(headings(`\`\`\`\n## x\n\`\`\`\`\`\n## A\n${long}`)).toEqual([null, "A"]);
    expect(headings(`\`\`\`\`\n## x\n\`\`\`\n~~~~\n## y\n`)).toEqual([null]);
  });

  it("an unclosed fence runs to the end of the file", () => {
    expect(headings(`## A\n${long}\n\`\`\`\n## B\n${long}`)).toEqual(["A"]);
  });

  it("requires a space after the hashes and at most 3 spaces of indent", () => {
    expect(headings(`${long}\n##A\n    ## B\n   ## C\n${long}`)).toEqual([null, "C"]);
  });
});

describe("anchors", () => {
  it("slugifies GitHub-style and keeps Polish letters", () => {
    expect(slugify("Kopia zapasowa: Backup!")).toBe("kopia-zapasowa-backup");
    expect(slugify("Zażółć gęślą jaźń")).toBe("zażółć-gęślą-jaźń");
    expect(slugify("Use `npm` and [docs](http://x.y)")).toBe("use-npm-and-docs");
    expect(slugify("snake_case - dash")).toBe("snake_case---dash");
    expect(slugify("!!!")).toBe("section");
  });

  it("is unique per file", () => {
    const md = `## Backup\n${long}\n## Backup\n${long}\n### Backup\n${long}\n## Backup-1\n${long}`;
    expect(parseMarkdown(md, "f.md").sections.map((s) => s.anchor)).toEqual([
      "backup",
      "backup-1",
      "backup-2",
      "backup-1-1",
    ]);
  });
});

describe("merging short sections", () => {
  it("merges a section shorter than the minimum into the previous one, heading kept in the body", () => {
    const doc = parseMarkdown(`## A\n${long}\n## B\nshort\n### C\n${long}`, "f.md");
    expect(doc.sections.map((s) => s.heading)).toEqual(["A", "C"]);
    expect(doc.sections[0]!.body).toBe(`${long}\n\n## B\n\nshort`);
    expect(doc.sections.map((s) => s.ord)).toEqual([0, 1]);
  });

  it("merges an empty section and chains merges", () => {
    const doc = parseMarkdown(`intro\n## A\n## B\nb`, "f.md");
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]!.body).toBe("intro\n\n## A\n\n## B\n\nb");
  });

  it("keeps a short first section when there is nothing to merge into", () => {
    expect(headings(`## A\nshort\n## B\n${long}`)).toEqual(["A", "B"]);
  });

  it("a section of exactly the minimum length is kept", () => {
    expect(headings(`## A\n${long}\n## B\n${text(MIN_SECTION_CHARS - 1)}`)).toEqual(["A"]);
    expect(headings(`## A\n${long}\n## B\n${long}`)).toEqual(["A", "B"]);
  });

  it("merged anchors do not shift the others", () => {
    const md = `## X\n${long}\n## X\nshort\n## X\n${long}`;
    expect(parseMarkdown(md, "f.md").sections.map((s) => s.anchor)).toEqual(["x", "x-2"]);
  });
});

describe("splitting long sections", () => {
  const para = text(900, "p");

  it("splits on paragraph boundaries; parts keep heading and anchor", () => {
    const doc = parseMarkdown(`## A\n${para}\n\n${para}\n\n${para}\n## B\n${long}`, "f.md");
    expect(doc.sections.map((s) => [s.ord, s.heading, s.anchor, s.body.length])).toEqual([
      [0, "A", "a", 1802],
      [1, "A", "a", 900],
      [2, "B", "b", MIN_SECTION_CHARS],
    ]);
    expect(doc.sections.every((s) => s.body.length <= MAX_SECTION_CHARS)).toBe(true);
  });

  it("does not split a single oversized paragraph", () => {
    const doc = parseMarkdown(text(MAX_SECTION_CHARS + 500), "f.md");
    expect(doc.sections).toHaveLength(1);
  });

  it("does not cut inside a code block with blank lines", () => {
    const code = "```\n" + Array(30).fill(text(60, "c")).join("\n\n") + "\n```";
    const doc = parseMarkdown(`## A\n${para}\n\n${code}\n\n${para}`, "f.md");
    expect(doc.sections.map((s) => s.body.length)).toEqual([900, code.length, 900]);
    expect(doc.sections[1]!.body).toBe(code);
  });

  it("splits a section that grew by merging", () => {
    const big = text(1000, "p");
    const doc = parseMarkdown(`## A\n${big}\n\n${big}\n## B\n${text(150)}`, "f.md");
    expect(doc.sections.map((s) => s.heading)).toEqual(["A", "A"]);
    expect(doc.sections[1]!.body).toBe(`${big}\n\n## B\n\n${text(150)}`);
  });
});
