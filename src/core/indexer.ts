import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { IndexLockedError, IndexMissingError } from "./errors.js";
import { fold } from "./fold.js";
import { decodeMarkdown, parseMarkdown } from "./parse.js";
import { scanSource } from "./scan.js";
import type { IndexResult, LoadedConfig, ScannedFile } from "./types.js";

/** Bump when the schema, tokenizer or section parser changes. */
export const SCHEMA_VERSION = "2";
export const INDEX_DIRNAME = ".marian-knows";
export const INDEX_FILENAME = "index.db";
export const LOCK_FILENAME = "index.lock";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS docs(
  id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL,
  title TEXT, tags TEXT, fm TEXT,
  mtime INTEGER NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sections(
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL, anchor TEXT, heading TEXT, body TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
  title, heading, tags, body,
  tokenize='unicode61 remove_diacritics 2'
);
`;

const DROP_ALL = `
DROP TABLE IF EXISTS sections_fts;
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS docs;
DROP TABLE IF EXISTS meta;
`;

/** Index directory relative to the config's directory: `.marian-knows/<config file name without extension>`. */
export function indexDirName(config: LoadedConfig): string {
  return `${INDEX_DIRNAME}/${path.parse(config.configPath).name}`;
}

/**
 * Disk path of the index directory: `.marian-knows/<config name>/` next to the config file, so several
 * configs in one directory (`a.yml`, `b.yml`) keep separate indexes, locks and logs.
 */
export function indexDir(config: LoadedConfig): string {
  return path.join(config.configDir, indexDirName(config));
}

/** Disk path of the index database for a config: `.marian-knows/<config name>/index.db`. */
export function indexPath(config: LoadedConfig): string {
  return path.join(indexDir(config), INDEX_FILENAME);
}

/**
 * Opens an existing index read-only (works while `index` runs, thanks to WAL).
 * Missing file = IndexMissingError; another schema version = IndexMissingError with `outdated`.
 */
export function openIndexReadonly(config: LoadedConfig): Database.Database {
  const file = indexPath(config);
  if (!existsSync(file)) throw new IndexMissingError();
  const db = new Database(file, { readonly: true, fileMustExist: true });
  let version: string | undefined;
  try {
    version = readMeta(db, "schema_version");
  } catch {
    // No meta table or not a database at all: not an index we can read.
  }
  if (version !== SCHEMA_VERSION) {
    db.close();
    throw new IndexMissingError(true);
  }
  return db;
}

/**
 * Removes this config's index directory (database, WAL files, lock, logs) and `.marian-knows/` when it is
 * left empty; indexes of other configs stay. Refuses while a live `index` run holds the lock.
 * Returns false when there was nothing to remove. The config file stays.
 */
export function destroyIndex(config: LoadedConfig): boolean {
  const dir = indexDir(config);
  if (!existsSync(dir)) return false;
  // Taken, never released: the lock file goes away with the directory.
  acquireIndexLock(config);
  rmSync(dir, { recursive: true, force: true });
  try {
    rmdirSync(path.dirname(dir));
  } catch {
    // Not empty (another config's index, an old index): it stays.
  }
  return true;
}

/** Warning for an index from before per-config directories (`.marian-knows/index.db`), which nothing reads. */
function legacyIndexWarning(config: LoadedConfig): string[] {
  if (!existsSync(path.join(config.configDir, INDEX_DIRNAME, INDEX_FILENAME))) return [];
  return [
    `${INDEX_DIRNAME}/${INDEX_FILENAME} is an old index no longer used (this config's index: ` +
      `${indexDirName(config)}/); delete it with its -wal, -shm files and ${INDEX_DIRNAME}/logs/`,
  ];
}

/** Opens (and creates, if needed) the index database in WAL mode with the schema in place. */
export function openIndex(config: LoadedConfig): Database.Database {
  const file = indexPath(config);
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Takes `index.lock` in the index directory (holds the owner's pid). A lock left by a dead process is taken over.
 * Throws IndexLockedError when a live process holds it. Returns the release function.
 */
export function acquireIndexLock(config: LoadedConfig): () => void {
  const file = path.join(indexDir(config), LOCK_FILENAME);
  mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => unlinkSync(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    let pid = NaN;
    try {
      pid = Number.parseInt(readFileSync(file, "utf8"), 10);
    } catch {
      // Released in the meantime: retry.
    }
    if (attempt > 0 || (Number.isInteger(pid) && pid > 0 && isAlive(pid))) throw new IndexLockedError(pid);
    try {
      unlinkSync(file);
    } catch {
      // Someone else removed the stale lock first; the retry decides who wins.
    }
  }
}

interface IndexedDoc {
  id: number;
  path: string;
  mtime: number;
  size: number;
  hash: string;
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export function readMeta(db: Database.Database, key: string): string | undefined {
  return (db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

export interface IndexOptions {
  /** Drop everything and index from scratch. Also forced by a `schema_version` mismatch. */
  full?: boolean;
}

/**
 * Brings the index in line with the source directory, under the index lock and in one transaction.
 * Incremental: new paths are indexed, missing ones (deleted, newly excluded, unreadable) removed,
 * and a file whose `mtime` or `size` differs is hashed; same hash = only `mtime`/`size` updated,
 * a different hash = all its sections re-indexed. A full rebuild drops and recreates every table.
 * Counts added / changed / removed against the previous index content in both modes.
 */
export async function syncIndex(config: LoadedConfig, options: IndexOptions = {}): Promise<IndexResult> {
  const release = acquireIndexLock(config);
  try {
    const { files, warnings } = await scanSource(config);
    const db = openIndex(config);
    try {
      return sync(db, files, [...warnings, ...legacyIndexWarning(config)], options.full ?? false);
    } finally {
      db.close();
    }
  } finally {
    release();
  }
}

/** Full rebuild; same as `syncIndex(config, { full: true })`. */
export function rebuildIndex(config: LoadedConfig): Promise<IndexResult> {
  return syncIndex(config, { full: true });
}

function sync(db: Database.Database, files: ScannedFile[], warnings: string[], forceFull: boolean): IndexResult {
  const result: IndexResult = { full: false, files: 0, sections: 0, added: 0, changed: 0, removed: 0, warnings };

  db.transaction(() => {
    result.full = forceFull || readMeta(db, "schema_version") !== SCHEMA_VERSION;
    let indexed = new Map<string, IndexedDoc>();
    try {
      indexed = new Map(
        (db.prepare("SELECT id, path, mtime, size, hash FROM docs").all() as IndexedDoc[]).map((d) => [d.path, d]),
      );
    } catch (e) {
      // An index from another schema version may lack these columns; it is rebuilt anyway.
      if (!result.full) throw e;
    }

    // A full rebuild starts from empty tables but still reports changes against the old content.
    const previousHash = new Map([...indexed].map(([p, d]) => [p, d.hash]));
    if (result.full) {
      db.exec(DROP_ALL);
      db.exec(SCHEMA);
      indexed.clear();
    }

    const insertDoc = db.prepare(
      "INSERT INTO docs(path, title, tags, fm, mtime, size, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const updateDoc = db.prepare("UPDATE docs SET title = ?, tags = ?, fm = ?, mtime = ?, size = ?, hash = ? WHERE id = ?");
    const touchDoc = db.prepare("UPDATE docs SET mtime = ?, size = ? WHERE id = ?");
    const deleteDoc = db.prepare("DELETE FROM docs WHERE id = ?");
    const insertSection = db.prepare("INSERT INTO sections(doc_id, ord, anchor, heading, body) VALUES (?, ?, ?, ?, ?)");
    const insertFts = db.prepare("INSERT INTO sections_fts(rowid, title, heading, tags, body) VALUES (?, ?, ?, ?, ?)");
    const deleteSections = db.prepare("DELETE FROM sections WHERE doc_id = ?");
    const deleteFts = db.prepare("DELETE FROM sections_fts WHERE rowid IN (SELECT id FROM sections WHERE doc_id = ?)");
    const setMeta = db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)");

    const dropSections = (docId: number) => {
      deleteFts.run(docId);
      deleteSections.run(docId);
    };

    /** Parses and stores a file; `docId` given = replace that row's content, keeping its id. */
    const store = (f: ScannedFile, bytes: Buffer, hash: string, docId?: number) => {
      const parsed = parseMarkdown(decodeMarkdown(bytes), path.posix.basename(f.virtualPath));
      for (const w of parsed.warnings) warnings.push(`${f.virtualPath}: ${w}`);
      const meta = [
        parsed.title,
        JSON.stringify(parsed.tags),
        parsed.frontmatter ? JSON.stringify(parsed.frontmatter) : null,
        f.mtime,
        f.size,
        hash,
      ] as const;
      if (docId === undefined) {
        docId = Number(insertDoc.run(f.virtualPath, ...meta).lastInsertRowid);
      } else {
        dropSections(docId);
        updateDoc.run(...meta, docId);
      }
      // FTS columns are folded (see fold.ts); docs and sections keep the original text.
      const ftsTitle = fold(parsed.title);
      const ftsTags = fold(parsed.tags.join(" "));
      for (const s of parsed.sections) {
        const sectionId = insertSection.run(docId, s.ord, s.anchor, s.heading, s.body).lastInsertRowid;
        insertFts.run(sectionId, ftsTitle, s.heading === null ? null : fold(s.heading), ftsTags, fold(s.body));
      }
    };

    for (const f of files) {
      const old = indexed.get(f.virtualPath);
      if (old && old.mtime === f.mtime && old.size === f.size) {
        indexed.delete(f.virtualPath);
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = readFileSync(f.diskPath);
      } catch (e) {
        // Unreadable: treated as absent, so a previously indexed version is removed below.
        warnings.push(`skipped ${f.virtualPath}: cannot read (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`);
        continue;
      }
      // Stat and read are separate steps; store what was actually read.
      const current = { ...f, size: bytes.length };
      const hash = sha256(bytes);

      if (old) {
        indexed.delete(f.virtualPath);
        if (old.hash === hash) touchDoc.run(current.mtime, current.size, old.id);
        else store(current, bytes, hash, old.id);
      } else {
        store(current, bytes, hash);
      }

      const before = previousHash.get(f.virtualPath);
      if (before === undefined) result.added++;
      else if (before !== hash) result.changed++;
    }

    // Whatever is left was not in the file set (or could not be read).
    for (const d of indexed.values()) {
      dropSections(d.id);
      deleteDoc.run(d.id);
    }
    const present = new Set((db.prepare("SELECT path FROM docs").all() as { path: string }[]).map((r) => r.path));
    result.removed = [...previousHash.keys()].filter((p) => !present.has(p)).length;

    result.files = present.size;
    result.sections = (db.prepare("SELECT count(*) AS n FROM sections").get() as { n: number }).n;
    setMeta.run("schema_version", SCHEMA_VERSION);
    setMeta.run("indexed_at", new Date().toISOString());
  }).immediate();

  return result;
}
