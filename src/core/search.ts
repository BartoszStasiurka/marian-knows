import { hasTag, inScope, scopeWarnings, validateScope, type DocFilterOptions } from "./filter.js";
import { fold } from "./fold.js";
import { openIndexReadonly } from "./indexer.js";
import type { LoadedConfig } from "./types.js";

/** bm25 weights in `sections_fts` column order: title, heading, tags, body. */
export const RANK_WEIGHTS = [10, 5, 5, 1] as const;
/** Strict (AND) results below this count trigger the OR fallback. */
export const FALLBACK_THRESHOLD = 3;
export const DEFAULT_LIMIT = 10;
/** Words longer than this lose `TRIM_CHARS` letters before prefix matching. */
export const TRIM_ABOVE = 5;
export const TRIM_CHARS = 2;

/** Built-in PL/EN stop words, compared after lower-casing, NFC and `ł` folding. */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  [
    // Polish
    "a", "aby", "ale", "albo", "ani", "bo", "by", "być", "co", "czy", "czyli", "dla", "do", "gdy", "gdzie",
    "i", "ich", "im", "jak", "jaki", "jaka", "jakie", "jako", "je", "jego", "jej", "jest", "jeśli", "jeżeli",
    "już", "ku", "lub", "ma", "mi", "na", "nad", "nie", "niż", "o", "od", "oraz", "po", "pod", "przez", "przy",
    "się", "są", "ta", "tak", "także", "te", "tego", "ten", "też", "to", "tu", "tylko", "u", "w", "we", "więc",
    "z", "za", "ze", "że", "żeby", "który", "która", "które", "którzy",
    // English
    "an", "and", "are", "as", "at", "be", "by", "can", "does", "for", "from", "how", "in", "is", "it", "of",
    "on", "or", "that", "the", "this", "was", "what", "when", "where", "which", "who", "why", "with",
  ].map((w) => fold(w)),
);

export interface PreparedQuery {
  /** Meaningful words: split, lower-cased, folded, stop words removed (unless only stop words were given). */
  words: string[];
  /** FTS5 MATCH expressions; null when the query has no searchable words. */
  and: string | null;
  or: string | null;
}

/**
 * Turns user input into FTS5 expressions. Everything but letters and digits is a separator, so FTS5
 * syntax never reaches MATCH; each term is quoted. Without `exact`, words longer than `TRIM_ABOVE`
 * lose `TRIM_CHARS` letters and every term is a prefix match (cheap Polish inflection).
 */
export function prepareQuery(query: string, options: { exact?: boolean } = {}): PreparedQuery {
  const all = fold(query.normalize("NFC").toLowerCase())
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const meaningful = all.filter((w) => !STOP_WORDS.has(w));
  const words = meaningful.length ? meaningful : all;
  if (!words.length) return { words, and: null, or: null };

  const terms = words.map((w) => {
    if (options.exact) return `"${w}"`;
    const chars = [...w];
    const stem = chars.length > TRIM_ABOVE ? chars.slice(0, -TRIM_CHARS).join("") : w;
    return `"${stem}"*`;
  });
  return { words, and: terms.join(" "), or: terms.join(" OR ") };
}

export interface SearchOptions extends DocFilterOptions {
  /** Max number of files; default `DEFAULT_LIMIT`. */
  limit?: number;
  /** No trimming, no prefix, no OR fallback. */
  exact?: boolean;
  /** Fill `snippet` from the best section. */
  snippets?: boolean;
}

export interface SearchHit {
  path: string;
  title: string | null;
  tags: string[];
  /** bm25 of the best section; lower is better, comparable within one query only. */
  score: number;
  /** Anchor of the best section; null for text before the first heading. */
  anchor: string | null;
  /** Best section's text around the first match, matches in `[...]`; null without `snippets`. */
  snippet: string | null;
}

export interface SearchResult {
  /** Ranked files, at most `limit`. */
  hits: SearchHit[];
  /** A valid scope that covers no indexed file. */
  warnings: string[];
}

interface Row {
  path: string;
  title: string | null;
  tags: string;
  score: number;
  anchor: string | null;
  body: string;
  marked: string | null;
}

// Private-use characters: highlight() markers that cannot clash with brackets in the text.
const OPEN = "";
const CLOSE = "";

/**
 * Searches the index. Sections are ranked by weighted bm25; each file is ranked by its best section,
 * whose anchor it returns. Strict AND first; when that yields fewer than `FALLBACK_THRESHOLD` files and
 * the query has more than one meaningful word, OR results are appended below the strict ones.
 * Scope (`paths`, `excludePaths`) and `tag` filter files before the fallback check and the limit.
 */
export function search(config: LoadedConfig, query: string, options: SearchOptions = {}): SearchResult {
  validateScope(options);
  const q = prepareQuery(query, options);
  const limit = options.limit ?? DEFAULT_LIMIT;

  // Opened before the query check, so a missing index is reported before "no results".
  const db = openIndexReadonly(config);
  try {
    const warnings = scopeWarnings(db, options);
    if (!q.and || limit <= 0) return { hits: [], warnings };

    const stmt = db.prepare(`
      SELECT d.path, d.title, d.tags, s.anchor, s.body,
             bm25(sections_fts, ${RANK_WEIGHTS.join(", ")}) AS score,
             ${options.snippets ? `highlight(sections_fts, 3, '${OPEN}', '${CLOSE}')` : "NULL"} AS marked
      FROM sections_fts
      JOIN sections s ON s.id = sections_fts.rowid
      JOIN docs d ON d.id = s.doc_id
      WHERE sections_fts MATCH ?
      ORDER BY score, d.path, s.ord
    `);
    // Scope and tag go before the fallback check and the limit.
    const run = (match: string) =>
      bestPerFile(stmt.all(match) as Row[]).filter(
        (r) => inScope(r.path, options) && hasTag(JSON.parse(r.tags) as string[], options.tag),
      );

    let rows = run(q.and);
    if (!options.exact && rows.length < FALLBACK_THRESHOLD && q.words.length > 1) {
      const strict = new Set(rows.map((r) => r.path));
      rows = rows.concat(run(q.or!).filter((r) => !strict.has(r.path)));
    }

    const hits = rows.slice(0, limit).map((r) => ({
      path: r.path,
      title: r.title,
      tags: JSON.parse(r.tags) as string[],
      score: r.score,
      anchor: r.anchor,
      snippet: options.snippets ? makeSnippet(unfoldMarks(r.marked ?? r.body, r.body)) : null,
    }));
    return { hits, warnings };
  } finally {
    db.close();
  }
}

/** Rows arrive sorted by score; the first row of each file is its best section. */
function bestPerFile(rows: Row[]): Row[] {
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.path) && seen.add(r.path));
}

/** Copies highlight markers from the folded column text onto the original body (same offsets). */
function unfoldMarks(marked: string, original: string): string {
  let out = "";
  let i = 0;
  for (const c of marked) {
    if (c === OPEN || c === CLOSE) out += c;
    else out += original.slice(i, (i += c.length));
  }
  return out;
}

export const SNIPPET_CONTEXT = 60;
export const SNIPPET_CHARS = 200;

/**
 * Cuts about `SNIPPET_CHARS` of flattened text starting `SNIPPET_CONTEXT` chars before the first match,
 * on word boundaries, never inside a match. `…` marks a cut; matches become `[...]`.
 */
function makeSnippet(marked: string): string {
  const flat = marked.replace(/\s+/g, " ").trim();
  const first = flat.indexOf(OPEN);

  let start = first < 0 ? 0 : Math.max(0, first - SNIPPET_CONTEXT);
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space >= 0 && space < first) start = space + 1;
  }

  let end = Math.min(flat.length, start + SNIPPET_CHARS);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space > start) end = space;
  }
  const lastOpen = flat.lastIndexOf(OPEN, end - 1);
  if (lastOpen >= start && flat.lastIndexOf(CLOSE, end - 1) < lastOpen) end = flat.indexOf(CLOSE, lastOpen) + 1;

  const text = flat.slice(start, end).trim().replaceAll(OPEN, "[").replaceAll(CLOSE, "]");
  return `${start > 0 ? "…" : ""}${text}${end < flat.length ? "…" : ""}`;
}
