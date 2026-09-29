import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { decodeMarkdown, parseMarkdown } from "./parse.js";
import { scanSource } from "./scan.js";
import type { IndexResult, LoadedConfig } from "./types.js";

/** Bump when the schema, tokenizer or section parser changes. */
export const SCHEMA_VERSION = "1";
export const INDEX_DIRNAME = ".marian-knows";
export const INDEX_FILENAME = "index.db";

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

/** Disk path of the index database for a config: `.marian-knows/index.db` next to the config file. */
export function indexPath(config: LoadedConfig): string {
  return path.join(config.configDir, INDEX_DIRNAME, INDEX_FILENAME);
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

interface ReadDoc {
  virtualPath: string;
  bytes: Buffer;
  mtime: number;
  size: number;
}

/**
 * Full rebuild: scan, parse every file, replace the whole index in one transaction.
 * Counts added / changed / removed against the previous index content (by path and hash).
 */
export async function rebuildIndex(config: LoadedConfig): Promise<IndexResult> {
  const { files, warnings } = await scanSource(config);

  // Read outside the transaction; an unreadable file is a warning, not a failure.
  const docs: ReadDoc[] = [];
  for (const f of files) {
    try {
      const st = statSync(f.diskPath);
      docs.push({ virtualPath: f.virtualPath, bytes: readFileSync(f.diskPath), mtime: Math.floor(st.mtimeMs), size: st.size });
    } catch (e) {
      warnings.push(`skipped ${f.virtualPath}: cannot read (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`);
    }
  }

  const db = openIndex(config);
  try {
    const previous = new Map(
      (db.prepare("SELECT path, hash FROM docs").all() as { path: string; hash: string }[]).map((r) => [r.path, r.hash]),
    );

    const insertDoc = db.prepare(
      "INSERT INTO docs(path, title, tags, fm, mtime, size, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertSection = db.prepare("INSERT INTO sections(doc_id, ord, anchor, heading, body) VALUES (?, ?, ?, ?, ?)");
    const insertFts = db.prepare("INSERT INTO sections_fts(rowid, title, heading, tags, body) VALUES (?, ?, ?, ?, ?)");
    const setMeta = db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)");

    const result: IndexResult = { files: docs.length, sections: 0, added: 0, changed: 0, removed: 0, warnings };

    db.transaction(() => {
      db.exec("DELETE FROM sections_fts; DELETE FROM sections; DELETE FROM docs;");
      for (const d of docs) {
        const hash = createHash("sha256").update(d.bytes).digest("hex");
        const old = previous.get(d.virtualPath);
        if (old === undefined) result.added++;
        else if (old !== hash) result.changed++;
        previous.delete(d.virtualPath);

        const parsed = parseMarkdown(decodeMarkdown(d.bytes), path.posix.basename(d.virtualPath));
        for (const w of parsed.warnings) warnings.push(`${d.virtualPath}: ${w}`);

        const docId = insertDoc.run(
          d.virtualPath,
          parsed.title,
          JSON.stringify(parsed.tags),
          parsed.frontmatter ? JSON.stringify(parsed.frontmatter) : null,
          d.mtime,
          d.size,
          hash,
        ).lastInsertRowid;
        const ftsTags = parsed.tags.join(" ");
        for (const s of parsed.sections) {
          const sectionId = insertSection.run(docId, s.ord, s.anchor, s.heading, s.body).lastInsertRowid;
          insertFts.run(sectionId, parsed.title, s.heading, ftsTags, s.body);
          result.sections++;
        }
      }
      result.removed = previous.size;
      setMeta.run("schema_version", SCHEMA_VERSION);
      setMeta.run("indexed_at", new Date().toISOString());
    })();

    return result;
  } finally {
    db.close();
  }
}
