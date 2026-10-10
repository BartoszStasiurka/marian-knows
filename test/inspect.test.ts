import Database from "better-sqlite3";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DocNotFoundError,
  IndexLockedError,
  IndexMissingError,
  InvalidPathError,
  GET_MAX_CHARS,
  destroyIndex,
  get,
  getDoc,
  getSection,
  indexPath,
  list,
  loadConfig,
  parseDocRef,
  rebuildIndex,
  status,
} from "../src/core/index.js";
import { makeTree } from "./helpers.js";

async function indexed(files: Record<string, string>, yaml = "name: T\n") {
  const dir = makeTree({ ...files, "marian-knows.yml": yaml });
  const config = loadConfig(path.join(dir, "marian-knows.yml"));
  await rebuildIndex(config);
  return { dir, config };
}

const tagged = (tags: string) => `---\ntags: [${tags}]\n---\n# T\n\ntext\n`;

describe("list", () => {
  it("lists indexed files sorted by path in code point order", async () => {
    const { config } = await indexed({ "b.md": "# B", "a/z.md": "z", "Z.md": "# Zed", "ą.md": "x" });
    const { docs, warnings } = list(config);
    expect(docs.map((d) => d.path)).toEqual(["/Z.md", "/a/z.md", "/b.md", "/ą.md"]);
    expect(docs[0]).toEqual({ path: "/Z.md", title: "Zed", tags: [] });
    expect(warnings).toEqual([]);
  });

  it("filters by tag, --path and --exclude-path together", async () => {
    const { config } = await indexed({
      "srv/a.md": tagged("ops"),
      "srv/b.md": tagged("dev"),
      "srv/draft/c.md": tagged("Ops"),
      "srvx/d.md": tagged("ops"),
      "e.md": tagged("ops"),
    });
    const paths = (o: Parameters<typeof list>[1]) => list(config, o).docs.map((d) => d.path);
    expect(paths({ paths: ["/srv/"] })).toEqual(["/srv/a.md", "/srv/b.md", "/srv/draft/c.md"]);
    expect(paths({ paths: ["/srv/", "/e.md"], excludePaths: ["/srv/draft/"], tag: "ops" })).toEqual([
      "/e.md",
      "/srv/a.md",
    ]);
  });

  it("warns about a valid scope that covers no indexed file", async () => {
    const { config } = await indexed({ "a/x.md": "x" });
    expect(list(config, { paths: ["/nope/", "/a/"] })).toEqual({ docs: expect.any(Array), warnings: ["no indexed files under /nope/"] });
    expect(list(config, { paths: ["/y.md"] })).toEqual({ docs: [], warnings: ["not in the index: /y.md"] });
    expect(list(config, { paths: ["/a/"], excludePaths: ["/a/x.md"] })).toEqual({
      docs: [],
      warnings: ["no indexed files in scope"],
    });
    // A tag that matches nothing is not a scope problem.
    expect(list(config, { tag: "nope" })).toEqual({ docs: [], warnings: [] });
  });

  it("rejects invalid scope paths before touching the index", () => {
    const dir = makeTree({ "marian-knows.yml": "name: T\n" });
    const config = loadConfig(path.join(dir, "marian-knows.yml"));
    expect(() => list(config, { paths: ["/a//b/"] })).toThrow(InvalidPathError);
    expect(() => list(config)).toThrow(IndexMissingError);
  });
});

describe("getDoc", () => {
  it("returns the file content as on disk", async () => {
    const raw = "﻿# Tytuł\r\n\r\nTreść.\r\n";
    const { config } = await indexed({ "docs/api/readme.md": raw }, "name: T\npath: ./docs\n");
    expect(getDoc(config, "/api/readme.md")).toEqual({ path: "/api/readme.md", anchor: null, content: raw, truncated: false });
  });

  it("cuts long files at a line break and suggests anchors", async () => {
    const body = (n: number) => `${Array(20).fill("Zdanie testowe.").join(" ")}\n`.repeat(n);
    const raw = `# Doc\n\n## Pierwsza\n\n${body(5)}\n## Druga\n\n${body(5)}`;
    const { config } = await indexed({ "a.md": raw });
    const r = getDoc(config, "/a.md", { maxChars: 1000 });
    expect(r.truncated).toBe(true);
    const [kept, notice] = r.content.split("\n\n[truncated: ");
    expect(raw.startsWith(kept!)).toBe(true);
    expect(kept!.length).toBeLessThanOrEqual(1000);
    expect(raw[kept!.length]).toBe("\n");
    expect(notice).toBe(
      `showed ${kept!.length} of ${raw.length} characters. Read one section with get /a.md#<anchor>. ` +
        "Anchors: #pierwsza, #druga.]\n",
    );
    expect(getDoc(config, "/a.md", { maxChars: 0 })).toMatchObject({ content: raw, truncated: false });
    expect(getDoc(config, "/a.md", { maxChars: raw.length })).toMatchObject({ content: raw, truncated: false });
    // Default cap applies when no option is given.
    expect(getDoc(config, "/a.md").truncated).toBe(raw.length > GET_MAX_CHARS);
  });

  it("never cuts inside a surrogate pair", async () => {
    const { config } = await indexed({ "a.md": "😀".repeat(100) });
    const r = getDoc(config, "/a.md", { maxChars: 51 });
    expect(r.content.startsWith("😀".repeat(25) + "\n\n[truncated: showed 50 of 200 characters.]")).toBe(true);
  });

  it("serves only indexed files", async () => {
    const { dir, config } = await indexed({ "a.md": "a", "draft/b.md": "b" }, "name: T\nexclude: draft/**\n");
    writeFileSync(path.join(dir, "new.md"), "not indexed yet");
    expect(() => getDoc(config, "/draft/b.md")).toThrow("not in the index: /draft/b.md");
    expect(() => getDoc(config, "/new.md")).toThrow(DocNotFoundError);
    expect(() => getDoc(config, "/marian-knows.yml")).toThrow(DocNotFoundError);
    expect(() => getDoc(config, "/A.md")).toThrow(DocNotFoundError);
  });

  it("rejects invalid paths and directories", async () => {
    const { config } = await indexed({ "a.md": "a" });
    for (const p of ["a.md", "/../a.md", "/x/", "/"]) expect(() => getDoc(config, p)).toThrow(InvalidPathError);
    expect(() => getDoc(config, "/x/")).toThrow("must be a file path, not a directory");
  });

  it("reports a file deleted after indexing", async () => {
    const { dir, config } = await indexed({ "a.md": "a" });
    rmSync(path.join(dir, "a.md"));
    expect(() => getDoc(config, "/a.md")).toThrow(/cannot read \/a\.md \(ENOENT\)/);
  });
});

describe("getSection / get", () => {
  const PAD = "Lorem ipsum dolor sit amet consectetur. ".repeat(6);
  const raw =
    `---\ntitle: Deploy\n---\nWstęp. ${PAD}\n\n## Backup\n\nKopia o 03:00. ${PAD}\n\n` +
    `### Retencja\n\n7 dni. ${PAD}\n\n## Krótka\n\nmało\n\n## Długa\n\n${`${PAD}\n\n`.repeat(12)}`;

  it("returns the heading and body of one section", async () => {
    const { config } = await indexed({ "a.md": raw });
    expect(getSection(config, "/a.md", "retencja")).toEqual({
      path: "/a.md",
      anchor: "retencja",
      // A short section merged into the previous one comes with it.
      content: `### Retencja\n\n7 dni. ${PAD.trim()}\n\n## Krótka\n\nmało\n`,
      truncated: false,
    });
    expect(getSection(config, "/a.md", "backup").content).toBe(`## Backup\n\nKopia o 03:00. ${PAD.trim()}\n`);
  });

  it("joins every part of a split section", async () => {
    const { config } = await indexed({ "a.md": raw });
    const { content } = getSection(config, "/a.md", "długa");
    expect(content.startsWith("## Długa\n\n")).toBe(true);
    expect(content.split(PAD.trim()).length - 1).toBe(12);
  });

  it("unknown anchor: error listing the file's anchors", async () => {
    const { config } = await indexed({ "a.md": raw, "b.md": "no headings" });
    expect(() => getSection(config, "/a.md", "nope")).toThrow(
      "no section #nope in /a.md; anchors: #backup, #retencja, #długa",
    );
    expect(() => getSection(config, "/b.md", "x")).toThrow("no section #x in /b.md; the file has no sections");
    expect(() => getSection(config, "/a.md", "")).toThrow(InvalidPathError);
    expect(() => getSection(config, "/c.md", "x")).toThrow("not in the index: /c.md");
  });

  it("truncates a long section without anchor hints", async () => {
    const { config } = await indexed({ "a.md": raw });
    const r = getSection(config, "/a.md", "długa", { maxChars: 500 });
    expect(r.truncated).toBe(true);
    expect(r.content).toMatch(/\n\n\[truncated: showed \d+ of \d+ characters\.\]\n$/);
  });

  it("get takes <path> or <path>#<anchor>", async () => {
    const { config } = await indexed({ "a.md": raw });
    expect(get(config, "/a.md").content).toBe(raw);
    expect(get(config, "/a.md#retencja").anchor).toBe("retencja");
    expect(parseDocRef("/a/b.md#x#y")).toEqual({ path: "/a/b.md", anchor: "x#y" });
    for (const ref of ["/a.md#", "a.md#x", "/x/#a"]) expect(() => parseDocRef(ref)).toThrow(InvalidPathError);
  });
});

describe("status", () => {
  it("reports config and a missing index", () => {
    const dir = makeTree({ "marian-knows.yml": "name: Baza\npath: ./docs\nexclude: draft/**\n" });
    const config = loadConfig(path.join(dir, "marian-knows.yml"));
    expect(status(config)).toEqual({
      name: "Baza",
      description: null,
      config: path.join(dir, "marian-knows.yml"),
      path: path.join(dir, "docs"),
      pathExists: false,
      exclude: ["draft/**"],
      index: "missing",
      files: null,
      sections: null,
      dbSize: null,
      indexedAt: null,
      ageSeconds: null,
    });
  });

  it("reports counts, size, index time and age", async () => {
    const { config } = await indexed({ "a.md": "# A\n\n## S1\n\n" + "x".repeat(300) + "\n\n## S2\n\n" + "y".repeat(300), "b.md": "b" });
    const s = status(config);
    const now = new Date(Date.parse(s.indexedAt!) + 90_000);
    expect(status(config, now)).toMatchObject({ index: "ok", files: 2, sections: 3, ageSeconds: 90 });
    expect(s.dbSize).toBeGreaterThan(0);
  });

  it("reports an index from another schema version as outdated", async () => {
    const { config } = await indexed({ "a.md": "a" });
    const db = new Database(indexPath(config));
    db.prepare("UPDATE meta SET value = 'old' WHERE key = 'schema_version'").run();
    db.close();
    expect(status(config)).toMatchObject({ index: "outdated", files: null, dbSize: expect.any(Number) });
  });
});

describe("destroyIndex", () => {
  it("removes .marian-knows/ and keeps the config and sources", async () => {
    const { dir, config } = await indexed({ "a.md": "a" });
    expect(destroyIndex(config)).toBe(true);
    expect(existsSync(path.join(dir, ".marian-knows"))).toBe(false);
    expect(existsSync(path.join(dir, "marian-knows.yml"))).toBe(true);
    expect(existsSync(path.join(dir, "a.md"))).toBe(true);
    expect(destroyIndex(config)).toBe(false);
  });

  it("refuses while a live index run holds the lock", async () => {
    const { dir, config } = await indexed({ "a.md": "a" });
    writeFileSync(path.join(dir, ".marian-knows", "marian-knows", "index.lock"), String(process.ppid));
    expect(() => destroyIndex(config)).toThrow(IndexLockedError);
    expect(existsSync(indexPath(config))).toBe(true);
  });
});
