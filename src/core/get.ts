import { readFileSync } from "node:fs";
import path from "node:path";
import { DocNotFoundError, InvalidPathError } from "./errors.js";
import { openIndexReadonly } from "./indexer.js";
import { parseMarkdown } from "./parse.js";
import type { LoadedConfig, Section } from "./types.js";
import { validateVirtualPath } from "./virtual-path.js";

/** Default cap on `get` output, in UTF-16 code units (JS string length). */
export const GET_MAX_CHARS = 20_000;
/** At most this many anchors are suggested in a truncation notice. */
export const NOTICE_MAX_ANCHORS = 50;

export interface DocRef {
  path: string;
  /** Section anchor after `#`; null for the whole file. */
  anchor: string | null;
}

/**
 * Splits `<path>` or `<path>#<anchor>`. Scanned file names never contain `#`, so the first `#` starts
 * the anchor. Throws InvalidPathError on bad path syntax, a directory, or an empty anchor.
 */
export function parseDocRef(ref: string): DocRef {
  const hash = ref.indexOf("#");
  const virtualPath = hash < 0 ? ref : ref.slice(0, hash);
  const anchor = hash < 0 ? null : ref.slice(hash + 1).normalize("NFC");
  const problems = filePathProblems(virtualPath);
  if (anchor === "") problems.push("empty anchor after '#'");
  if (problems.length) throw new InvalidPathError(ref, problems);
  return { path: virtualPath, anchor };
}

function filePathProblems(virtualPath: string): string[] {
  const problems = validateVirtualPath(virtualPath);
  if (virtualPath.endsWith("/")) problems.push("must be a file path, not a directory");
  return problems;
}

export interface GetOptions {
  /** Cap on `content`; default `GET_MAX_CHARS`. 0 = no cap. */
  maxChars?: number;
}

export interface GetResult {
  path: string;
  /** The requested section; null for the whole file. */
  anchor: string | null;
  /**
   * Whole file: as on disk (UTF-8), not the normalized text the parser sees.
   * Section: heading line and the text of every part with this anchor, as the parser sees it.
   * When over the cap: cut, followed by a truncation notice.
   */
  content: string;
  truncated: boolean;
}

/**
 * Reads an indexed file by its virtual path. Only paths present in the index are served, and the disk
 * path is resolved inside the source directory, so `get` never reads anything `list` would not show.
 */
function readIndexed(config: LoadedConfig, virtualPath: string): string {
  const problems = filePathProblems(virtualPath);
  if (problems.length) throw new InvalidPathError(virtualPath, problems);

  const db = openIndexReadonly(config);
  try {
    if (!db.prepare("SELECT 1 FROM docs WHERE path = ?").get(virtualPath)) {
      throw new DocNotFoundError(virtualPath, `not in the index: ${virtualPath}`);
    }
  } finally {
    db.close();
  }

  const diskPath = path.join(config.sourceDir, ...virtualPath.split("/"));
  const rel = path.relative(config.sourceDir, diskPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new DocNotFoundError(virtualPath, `outside the source directory: ${virtualPath}`);
  }
  try {
    return readFileSync(diskPath, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
    throw new DocNotFoundError(virtualPath, `cannot read ${virtualPath} (${code}); run: marian-knows index`);
  }
}

const sectionsOf = (virtualPath: string, content: string) =>
  parseMarkdown(content, path.posix.basename(virtualPath)).sections;

/** Section anchors in file order, each once (parts of a split section share one). */
function anchorsOf(sections: Section[]): string[] {
  return [...new Set(sections.flatMap((s) => (s.anchor === null ? [] : [s.anchor])))];
}

/** Whole indexed file by virtual path. */
export function getDoc(config: LoadedConfig, virtualPath: string, options: GetOptions = {}): GetResult {
  const content = readIndexed(config, virtualPath);
  const max = options.maxChars ?? GET_MAX_CHARS;
  if (!max || content.length <= max) return { path: virtualPath, anchor: null, content, truncated: false };

  const anchors = anchorsOf(sectionsOf(virtualPath, content));
  const shown = anchors.slice(0, NOTICE_MAX_ANCHORS).map((a) => `#${a}`);
  if (anchors.length > shown.length) shown.push("…");
  const hint = anchors.length
    ? ` Read one section with get ${virtualPath}#<anchor>. Anchors: ${shown.join(", ")}.`
    : "";
  return { path: virtualPath, anchor: null, ...truncate(content, max, hint), truncated: true };
}

/**
 * One section of an indexed file: heading line plus the text of all parts with this anchor (a long
 * section is split into parts that share it). The file is parsed as it is on disk now, so anchors match
 * the current text even when the index lags behind. Unknown anchor = DocNotFoundError listing the
 * anchors the file has.
 */
export function getSection(
  config: LoadedConfig,
  virtualPath: string,
  anchor: string,
  options: GetOptions = {},
): GetResult {
  const wanted = anchor.normalize("NFC");
  if (wanted === "") throw new InvalidPathError(`${virtualPath}#`, ["empty anchor after '#'"]);
  const sections = sectionsOf(virtualPath, readIndexed(config, virtualPath));
  const parts = sections.filter((s) => s.anchor === wanted);
  if (!parts.length) {
    const anchors = anchorsOf(sections);
    const known = anchors.length ? `; anchors: ${anchors.map((a) => `#${a}`).join(", ")}` : "; the file has no sections";
    throw new DocNotFoundError(virtualPath, `no section #${wanted} in ${virtualPath}${known}`);
  }

  const first = parts[0]!;
  const heading = `${"#".repeat(first.level ?? 2)} ${first.heading}`;
  const content = [heading, ...parts.map((p) => p.body).filter((b) => b !== "")].join("\n\n") + "\n";
  const max = options.maxChars ?? GET_MAX_CHARS;
  if (!max || content.length <= max) return { path: virtualPath, anchor: wanted, content, truncated: false };
  return { path: virtualPath, anchor: wanted, ...truncate(content, max, ""), truncated: true };
}

/** `getDoc` or `getSection`, from `<path>` or `<path>#<anchor>`. */
export function get(config: LoadedConfig, ref: string, options: GetOptions = {}): GetResult {
  const { path: virtualPath, anchor } = parseDocRef(ref);
  return anchor === null ? getDoc(config, virtualPath, options) : getSection(config, virtualPath, anchor, options);
}

/**
 * Cuts `content` to at most `max` chars, at the last line break in the second half of that range when
 * there is one (never inside a surrogate pair), and appends a notice with the char counts and `hint`.
 */
function truncate(content: string, max: number, hint: string): { content: string } {
  let cut = content.lastIndexOf("\n", max);
  if (cut < max / 2) {
    cut = max;
    const code = content.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut--;
  }
  const kept = content.slice(0, cut).trimEnd();
  return { content: `${kept}\n\n[truncated: showed ${kept.length} of ${content.length} characters.${hint}]\n` };
}
