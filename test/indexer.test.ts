import Database from "better-sqlite3";
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  IndexLockedError,
  LOCK_FILENAME,
  SCHEMA_VERSION,
  acquireIndexLock,
  destroyIndex,
  indexPath,
  loadConfig,
  rebuildIndex,
  syncIndex,
} from "../src/core/index.js";
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
  it("creates .marian-knows/<config name>/index.db next to the config in WAL mode", async () => {
    const { dir, config } = project({ "a.md": "# A" });
    await rebuildIndex(config);
    const file = path.join(dir, ".marian-knows", "marian-knows", "index.db");
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

  it("matches without diacritics; ł is folded at index time (no Unicode decomposition)", async () => {
    const { config } = project({ "a.md": "# Zwierzęta\n\nŻółw i źrebię." });
    await rebuildIndex(config);
    const count = (q: string) =>
      query(indexPath(config), "SELECT rowid FROM sections_fts WHERE sections_fts MATCH ?", q).length;
    expect(count("zrebie")).toBe(1);
    expect(count("zolw")).toBe(1);
    // Raw FTS does not fold the query; search() does.
    expect(count("zołw")).toBe(0);
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

function exec(dbFile: string, sql: string) {
  const db = new Database(dbFile);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

/** Section ids per path: a re-indexed file gets new ids, an untouched one keeps them. */
function sectionIds(config: ReturnType<typeof loadConfig>): Record<string, number[]> {
  const rows = query<{ path: string; id: number }>(
    indexPath(config),
    "SELECT d.path, s.id FROM sections s JOIN docs d ON d.id = s.doc_id ORDER BY s.id",
  );
  const out: Record<string, number[]> = {};
  for (const r of rows) (out[r.path] ??= []).push(r.id);
  return out;
}

/** Sets the file's mtime to a fixed point, so tests do not depend on clock resolution. */
function setMtime(file: string, seconds: number) {
  utimesSync(file, seconds, seconds);
}

describe("syncIndex", () => {
  it("indexes everything on the first run, as a full rebuild", async () => {
    const { config } = project({ "a.md": "# A\n\nalpha", "b.md": "# B\n\nbeta" });
    expect(await syncIndex(config)).toMatchObject({ full: true, files: 2, sections: 2, added: 2, changed: 0, removed: 0 });
  });

  it("does nothing when no file changed", async () => {
    const { config } = project({ "a.md": "# A\n\nalpha", "b.md": "# B\n\nbeta" });
    await syncIndex(config);
    const ids = sectionIds(config);
    expect(await syncIndex(config)).toMatchObject({ full: false, files: 2, sections: 2, added: 0, changed: 0, removed: 0 });
    expect(sectionIds(config)).toEqual(ids);
  });

  it("re-indexes only files whose content changed", async () => {
    const { dir, config } = project({ "keep.md": "# Keep\n\nkept", "edit.md": "# Edit\n\nv1" });
    await syncIndex(config);
    const ids = sectionIds(config);

    writeFileSync(path.join(dir, "edit.md"), "# Edited\n\nversion two");
    expect(await syncIndex(config)).toMatchObject({ full: false, files: 2, added: 0, changed: 1, removed: 0 });

    const after = sectionIds(config);
    expect(after["/keep.md"]).toEqual(ids["/keep.md"]);
    expect(query(indexPath(config), "SELECT title FROM docs WHERE path = '/edit.md'")).toEqual([{ title: "Edited" }]);
    // Old FTS rows of the file are gone, new ones are there.
    const match = (q: string) => query(indexPath(config), "SELECT rowid FROM sections_fts WHERE sections_fts MATCH ?", q).length;
    expect(match("v1")).toBe(0);
    expect(match("two")).toBe(1);
    expect(query(indexPath(config), "SELECT rowid FROM sections_fts")).toHaveLength(2);
  });

  it("only updates mtime when the file was touched but its hash is the same", async () => {
    const { dir, config } = project({ "a.md": "# A" });
    const file = path.join(dir, "a.md");
    setMtime(file, 1_000_000);
    await syncIndex(config);
    const ids = sectionIds(config);

    setMtime(file, 2_000_000);
    expect(await syncIndex(config)).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(sectionIds(config)).toEqual(ids);
    expect(query(indexPath(config), "SELECT mtime FROM docs")).toEqual([{ mtime: 2_000_000_000 }]);
  });

  it("detects a same-size change through the hash", async () => {
    const { dir, config } = project({ "a.md": "aaaa" });
    const file = path.join(dir, "a.md");
    setMtime(file, 1_000_000);
    await syncIndex(config);

    writeFileSync(file, "bbbb");
    setMtime(file, 2_000_000);
    expect(await syncIndex(config)).toMatchObject({ changed: 1 });
    expect(query(indexPath(config), "SELECT body FROM sections")).toEqual([{ body: "bbbb" }]);
  });

  it("trusts mtime and size: an edit that keeps both is only picked up by --full", async () => {
    const { dir, config } = project({ "a.md": "aaaa" });
    const file = path.join(dir, "a.md");
    setMtime(file, 1_000_000);
    await syncIndex(config);

    writeFileSync(file, "bbbb");
    setMtime(file, 1_000_000);
    expect(await syncIndex(config)).toMatchObject({ changed: 0 });
    expect(await syncIndex(config, { full: true })).toMatchObject({ full: true, changed: 1 });
    expect(query(indexPath(config), "SELECT body FROM sections")).toEqual([{ body: "bbbb" }]);
  });

  it("removes deleted files and files that became excluded", async () => {
    const { dir } = project({ "a.md": "a", "gone.md": "g", "draft/d.md": "d" });
    const configFile = path.join(dir, "marian-knows.yml");
    await syncIndex(loadConfig(configFile));

    rmSync(path.join(dir, "gone.md"));
    writeFileSync(configFile, 'name: T\nexclude: "draft/**"\n');
    const config = loadConfig(configFile);
    expect(await syncIndex(config)).toMatchObject({ full: false, files: 1, sections: 1, added: 0, changed: 0, removed: 2 });
    expect(query(indexPath(config), "SELECT path FROM docs")).toEqual([{ path: "/a.md" }]);
    expect(query(indexPath(config), "SELECT rowid FROM sections_fts")).toHaveLength(1);
  });

  it.skipIf(process.getuid?.() === 0)("removes a changed file that became unreadable", async () => {
    const { dir, config } = project({ "ok.md": "ok", "locked.md": "secret" });
    await syncIndex(config);
    const file = path.join(dir, "locked.md");
    writeFileSync(file, "secret, changed");
    chmodSync(file, 0o000);
    try {
      const r = await syncIndex(config);
      expect(r).toMatchObject({ files: 1, removed: 1 });
      expect(r.warnings).toEqual([expect.stringMatching(/^skipped \/locked\.md: cannot read/)]);
    } finally {
      chmodSync(file, 0o644);
    }
  });

  it("rebuilds from scratch on a schema_version mismatch", async () => {
    const { config } = project({ "a.md": "# A\n\nalpha" });
    await syncIndex(config);
    exec(indexPath(config), "UPDATE meta SET value = 'old' WHERE key = 'schema_version'");

    expect(await syncIndex(config)).toMatchObject({ full: true, files: 1, added: 0, changed: 0, removed: 0 });
    expect(query(indexPath(config), "SELECT body FROM sections")).toEqual([{ body: "alpha" }]);
    expect(query<{ value: string }>(indexPath(config), "SELECT value FROM meta WHERE key = 'schema_version'")[0]!.value).toBe(
      SCHEMA_VERSION,
    );
  });

  it("rebuilds an index whose tables have an older layout", async () => {
    const { config } = project({ "a.md": "# A\n\nalpha" });
    await syncIndex(config);
    exec(
      indexPath(config),
      `DROP TABLE sections_fts; DROP TABLE sections; DROP TABLE docs; DELETE FROM meta;
       CREATE TABLE docs(id INTEGER PRIMARY KEY, file TEXT);`,
    );
    expect(await syncIndex(config)).toMatchObject({ full: true, files: 1, sections: 1, added: 1 });
  });

  it("keeps the index untouched when the sync fails", async () => {
    const { dir, config } = project({ "a.md": "# A" });
    await syncIndex(config);
    writeFileSync(path.join(dir, "b.md"), "# B\n\nbeta");
    // A trigger that makes the section insert fail: the new doc must not survive the rollback.
    exec(indexPath(config), "CREATE TRIGGER boom BEFORE INSERT ON sections BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    await expect(syncIndex(config)).rejects.toThrow("boom");
    expect(query(indexPath(config), "SELECT path FROM docs")).toEqual([{ path: "/a.md" }]);
    expect(existsSync(path.join(dir, ".marian-knows", "marian-knows", LOCK_FILENAME))).toBe(false);
  });
});

describe("index directory per config", () => {
  it("keeps two configs in one directory apart; destroy removes only its own", async () => {
    const dir = makeTree({ "a/x.md": "# X", "b/y.md": "# Y", "a.yaml": "name: A\npath: ./a\n", "b.yml": "name: B\npath: ./b\n" });
    const a = loadConfig(path.join(dir, "a.yaml"));
    const b = loadConfig(path.join(dir, "b.yml"));
    await syncIndex(a);
    await syncIndex(b);
    expect(indexPath(a)).toBe(path.join(dir, ".marian-knows", "a", "index.db"));
    expect(query(indexPath(a), "SELECT path FROM docs")).toEqual([{ path: "/x.md" }]);
    expect(query(indexPath(b), "SELECT path FROM docs")).toEqual([{ path: "/y.md" }]);

    expect(destroyIndex(a)).toBe(true);
    expect(existsSync(indexPath(b))).toBe(true);
    expect(destroyIndex(b)).toBe(true);
    expect(existsSync(path.join(dir, ".marian-knows"))).toBe(false);
  });

  it("warns about an old index in .marian-knows/index.db and leaves it alone", async () => {
    const { dir, config } = project({ "a.md": "a", ".marian-knows/index.db": "old" });
    const { warnings } = await syncIndex(config);
    expect(warnings).toEqual([expect.stringContaining(".marian-knows/index.db is an old index no longer used")]);
    expect(destroyIndex(config)).toBe(true);
    expect(readFileSync(path.join(dir, ".marian-knows", "index.db"), "utf8")).toBe("old");
  });
});

describe("index lock", () => {
  const lockFile = (dir: string) => path.join(dir, ".marian-knows", "marian-knows", LOCK_FILENAME);

  it("refuses to run while another live process holds the lock", async () => {
    const { dir, config } = project({ "a.md": "a" });
    const release = acquireIndexLock(config);
    try {
      await expect(syncIndex(config)).rejects.toBeInstanceOf(IndexLockedError);
      await expect(syncIndex(config)).rejects.toThrow(`index is already running (pid ${process.pid})`);
      expect(existsSync(indexPath(config))).toBe(false);
    } finally {
      release();
    }
    expect(existsSync(lockFile(dir))).toBe(false);
    expect(await syncIndex(config)).toMatchObject({ files: 1 });
  });

  it("takes over a lock left by a dead process", async () => {
    const { dir, config } = project({ "a.md": "a", ".marian-knows/marian-knows/index.lock": "999999999" });
    expect(await syncIndex(config)).toMatchObject({ files: 1 });
    expect(existsSync(lockFile(dir))).toBe(false);
  });

  it("releases the lock after a run", async () => {
    const { dir, config } = project({ "a.md": "a" });
    await syncIndex(config);
    expect(existsSync(lockFile(dir))).toBe(false);
    expect(statSync(indexPath(config)).isFile()).toBe(true);
  });
});
