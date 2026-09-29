import Database from "better-sqlite3";
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, indexPath, loadConfig, rebuildIndex } from "../src/core/index.js";
import { makeTree } from "./helpers.js";

function project(files: Record<string, string>, yaml = "name: T\n") {
  const dir = makeTree({ ...files, "marian-knows.yml": yaml });
  return { dir, config: loadConfig(path.join(dir, "marian-knows.yml")) };
}

function query<T>(dbFile: string, sql: string, ...params: unknown[]): T[] {
  const db = new Database(dbFile, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

const LONG = "Lorem ipsum dolor sit amet. ".repeat(10);

describe("rebuildIndex", () => {
  it("creates .marian-knows/index.db next to the config in WAL mode", async () => {
    const { dir, config } = project({ "a.md": "# A" });
    await rebuildIndex(config);
    const file = path.join(dir, ".marian-knows", "index.db");
    expect(indexPath(config)).toBe(file);
    expect(existsSync(file)).toBe(true);
    expect(query<{ journal_mode: string }>(file, "PRAGMA journal_mode")[0]!.journal_mode).toBe("wal");
  });

  it("stores schema_version and indexed_at in meta", async () => {
    const { config } = project({ "a.md": "# A" });
    const before = Date.now();
    await rebuildIndex(config);
    const meta = Object.fromEntries(
      query<{ key: string; value: string }>(indexPath(config), "SELECT key, value FROM meta").map((r) => [r.key, r.value]),
    );
    expect(meta.schema_version).toBe(SCHEMA_VERSION);
    expect(Date.parse(meta.indexed_at!)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("stores docs, sections and FTS rows", async () => {
    const { config } = project({
      "notes/deploy.md": `---\ntitle: Deploy\ntags: [ops, server]\n---\nIntro ${LONG}\n\n## Backup\n\nCodzienny backup bazy. ${LONG}\n`,
    });
    const r = await rebuildIndex(config);
    expect(r).toMatchObject({ files: 1, sections: 2, added: 1, changed: 0, removed: 0, warnings: [] });

    const db = indexPath(config);
    const [doc] = query<{ path: string; title: string; tags: string; fm: string; hash: string }>(db, "SELECT * FROM docs");
    expect(doc).toMatchObject({ path: "/notes/deploy.md", title: "Deploy" });
    expect(JSON.parse(doc!.tags)).toEqual(["ops", "server"]);
    expect(JSON.parse(doc!.fm)).toEqual({ title: "Deploy", tags: ["ops", "server"] });
    expect(doc!.hash).toMatch(/^[0-9a-f]{64}$/);

    expect(query(db, "SELECT ord, anchor, heading FROM sections ORDER BY ord")).toEqual([
      { ord: 0, anchor: null, heading: null },
      { ord: 1, anchor: "backup", heading: "Backup" },
    ]);
    expect(
      query(db, "SELECT s.anchor, f.title, f.tags FROM sections_fts f JOIN sections s ON s.id = f.rowid WHERE sections_fts MATCH ?", "backup"),
    ).toEqual([{ anchor: "backup", title: "Deploy", tags: "ops server" }]);
  });

  it("matches without diacritics, except ł (no Unicode decomposition)", async () => {
    const { config } = project({ "a.md": "# Zwierzęta\n\nŻółw i źrebię." });
    await rebuildIndex(config);
    const count = (q: string) =>
      query(indexPath(config), "SELECT rowid FROM sections_fts WHERE sections_fts MATCH ?", q).length;
    expect(count("zrebie")).toBe(1);
    expect(count("zołw")).toBe(1);
    expect(count("zolw")).toBe(0);
  });

  it("counts added, changed and removed against the previous index", async () => {
    const { dir, config } = project({ "keep.md": "same", "edit.md": "v1", "gone.md": "x" });
    expect(await rebuildIndex(config)).toMatchObject({ files: 3, added: 3, changed: 0, removed: 0 });

    writeFileSync(path.join(dir, "edit.md"), "v2");
    rmSync(path.join(dir, "gone.md"));
    writeFileSync(path.join(dir, "new.md"), "n");
    expect(await rebuildIndex(config)).toMatchObject({ files: 3, added: 1, changed: 1, removed: 1 });

    const paths = query<{ path: string }>(indexPath(config), "SELECT path FROM docs ORDER BY path").map((r) => r.path);
    expect(paths).toEqual(["/edit.md", "/keep.md", "/new.md"]);
    // Old sections are gone with the full rebuild.
    expect(query(indexPath(config), "SELECT id FROM sections")).toHaveLength(3);
    expect(query(indexPath(config), "SELECT rowid FROM sections_fts")).toHaveLength(3);
  });

  it("prefixes parser warnings with the virtual path", async () => {
    const { config } = project({ "bad.md": "---\n: [\n---\nbody" });
    const r = await rebuildIndex(config);
    expect(r.files).toBe(1);
    expect(r.warnings).toEqual([expect.stringMatching(/^\/bad\.md: broken frontmatter/)]);
  });

  it.skipIf(process.getuid?.() === 0)("warns about an unreadable file and indexes the rest", async () => {
    const { dir, config } = project({ "ok.md": "ok", "locked.md": "secret" });
    chmodSync(path.join(dir, "locked.md"), 0o000);
    try {
      const r = await rebuildIndex(config);
      expect(r.files).toBe(1);
      expect(r.warnings).toEqual([expect.stringMatching(/^skipped \/locked\.md: cannot read/)]);
      expect(query(indexPath(config), "SELECT path FROM docs")).toEqual([{ path: "/ok.md" }]);
    } finally {
      chmodSync(path.join(dir, "locked.md"), 0o644);
    }
  });

  it("indexes nothing when the source directory is missing", async () => {
    const { config } = project({}, "name: T\npath: ./nope\n");
    const r = await rebuildIndex(config);
    expect(r).toMatchObject({ files: 0, sections: 0 });
    expect(r.warnings).toEqual([expect.stringMatching(/source directory does not exist/)]);
  });

  it("never scans its own .marian-knows directory", async () => {
    const { config } = project({ "a.md": "a", ".marian-knows/notes.md": "x" });
    await rebuildIndex(config);
    expect(query(indexPath(config), "SELECT path FROM docs")).toEqual([{ path: "/a.md" }]);
  });

  it("contains virtual paths only", async () => {
    const { dir, config } = project({ "docs/sub/a.md": `# A\n\n${LONG}`, "docs/b.md": "b" }, "name: T\npath: ./docs\n");
    await rebuildIndex(config);

    const paths = query<{ path: string }>(indexPath(config), "SELECT path FROM docs ORDER BY path").map((r) => r.path);
    expect(paths).toEqual(["/b.md", "/sub/a.md"]);

    // No disk path anywhere in the database files (db, and -wal / -shm if left behind).
    const indexDir = path.dirname(indexPath(config));
    for (const name of readdirSync(indexDir)) {
      const content = readFileSync(path.join(indexDir, name)).toString("latin1");
      expect(content).not.toContain(dir);
      expect(content).not.toContain(path.join(dir, "docs"));
    }
  });
});
