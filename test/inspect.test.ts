import Database from "better-sqlite3";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DocNotFoundError,
  IndexLockedError,
  IndexMissingError,
  InvalidPathError,
  destroyIndex,
  getDoc,
  indexPath,
  list,
  loadConfig,
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
    expect(getDoc(config, "/api/readme.md")).toEqual({ path: "/api/readme.md", content: raw });
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

describe("status", () => {
  it("reports config and a missing index", () => {
    const dir = makeTree({ "marian-knows.yml": "name: Baza\npath: ./docs\nexclude: draft/**\n" });
    const config = loadConfig(path.join(dir, "marian-knows.yml"));
    expect(status(config)).toEqual({
      name: "Baza",
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
    writeFileSync(path.join(dir, ".marian-knows", "index.lock"), String(process.pid));
    expect(() => destroyIndex(config)).toThrow(IndexLockedError);
    expect(existsSync(indexPath(config))).toBe(true);
  });
});
