import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ParsedDoc, Section } from "./types.js";

/** A section whose body is shorter than this is merged into the previous one. */
export const MIN_SECTION_CHARS = 200;
/** A section whose body is longer than this is split on paragraph boundaries. */
export const MAX_SECTION_CHARS = 2000;

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Decodes UTF-8 (BOM stripped) and normalizes line endings and Unicode. */
export function decodeMarkdown(bytes: Uint8Array): string {
  return normalizeText(new TextDecoder("utf-8").decode(bytes));
}

function normalizeText(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").normalize("NFC");
}

/** Reads and parses a Markdown file from disk. */
export function parseFile(diskPath: string): ParsedDoc {
  return parseMarkdown(decodeMarkdown(readFileSync(diskPath)), path.basename(diskPath));
}

/** Tracks fenced code blocks line by line; `inside` is true for fence lines and their content. */
class FenceTracker {
  private open: { char: string; length: number } | null = null;

  inside(line: string): boolean {
    if (this.open) {
      const { char, length } = this.open;
      const m = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
      if (m && m[1]![0] === char && m[1]!.length >= length) this.open = null;
      return true;
    }
    const m = FENCE_OPEN.exec(line);
    if (!m || (m[1]![0] === "`" && m[2]!.includes("`"))) return false;
    this.open = { char: m[1]![0]!, length: m[1]!.length };
    return true;
  }
}

function splitFrontmatter(text: string): { raw: string | null; body: string; unclosed: boolean } {
  const lines = text.split("\n");
  if (lines[0]?.trimEnd() !== "---") return { raw: null, body: text, unclosed: false };
  const end = lines.findIndex((l, i) => i > 0 && (l.trimEnd() === "---" || l.trimEnd() === "..."));
  if (end === -1) return { raw: null, body: text, unclosed: true };
  return { raw: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n"), unclosed: false };
}

function parseFrontmatter(raw: string, warnings: string[]): Record<string, unknown> | null {
  let data: unknown;
  try {
    data = YAML.parse(raw, { logLevel: "error" }) ?? {};
  } catch (e) {
    warnings.push(`broken frontmatter, metadata ignored: ${(e as Error).message.split("\n")[0]}`);
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    warnings.push("broken frontmatter, metadata ignored: expected a mapping");
    return null;
  }
  return data as Record<string, unknown>;
}

function toTags(value: unknown, warnings: string[]): string[] {
  let raw: string[];
  if (value === undefined || value === null) raw = [];
  else if (typeof value === "string") raw = value.split(",");
  else if (Array.isArray(value)) {
    raw = value.filter((v) => typeof v === "string" || typeof v === "number").map(String);
  } else {
    warnings.push("tags ignored: expected a string or a list");
    raw = [];
  }
  return [...new Set(raw.map((t) => t.trim()).filter((t) => t !== ""))];
}

function frontmatterTitle(value: unknown, warnings: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") {
    warnings.push("title ignored: expected a string");
    return null;
  }
  const title = String(value).trim();
  return title === "" ? null : title;
}

/** GitHub-style slug: lowercase, punctuation dropped, each whitespace char becomes '-'. */
export function slugify(heading: string): string {
  const slug = heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
  return slug === "" ? "section" : slug;
}

function uniqueAnchor(base: string, used: Set<string>): string {
  let anchor = base;
  for (let n = 1; used.has(anchor); n++) anchor = `${base}-${n}`;
  used.add(anchor);
  return anchor;
}

interface RawSection {
  level: 2 | 3 | null;
  heading: string | null;
  headingLine: string | null;
  anchor: string | null;
  lines: string[];
}

/** Splits the body into sections on H2/H3 outside code blocks. Also returns the first H1. */
function splitSections(body: string): { sections: RawSection[]; h1: string | null } {
  const fence = new FenceTracker();
  const used = new Set<string>();
  const sections: RawSection[] = [{ level: null, heading: null, headingLine: null, anchor: null, lines: [] }];
  let h1: string | null = null;

  for (const line of body.split("\n")) {
    const current = sections[sections.length - 1]!;
    const m = fence.inside(line) ? null : HEADING.exec(line);
    if (!m) {
      current.lines.push(line);
      continue;
    }
    const level = m[1]!.length;
    const text = (m[2] ?? "").trim();
    if (level === 1 && h1 === null) {
      h1 = text;
      // The title heading is metadata, not section 0 content.
      if (sections.length === 1) continue;
    }
    if (level === 2 || level === 3) {
      sections.push({ level, heading: text, headingLine: line.trim(), anchor: uniqueAnchor(slugify(text), used), lines: [] });
    } else {
      current.lines.push(line);
    }
  }
  return { sections, h1 };
}

/** Paragraphs separated by blank lines; code blocks are never cut. */
function paragraphs(text: string): string[] {
  const fence = new FenceTracker();
  const out: string[] = [];
  let buf: string[] = [];
  for (const line of text.split("\n")) {
    if (!fence.inside(line) && line.trim() === "") {
      if (buf.length) out.push(buf.join("\n"));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push(buf.join("\n"));
  return out;
}

/** Greedily packs paragraphs into parts of at most `max` chars. A single oversized paragraph stays whole. */
function splitLong(body: string, max: number): string[] {
  if (body.length <= max) return [body];
  const parts: string[] = [];
  let part = "";
  for (const p of paragraphs(body)) {
    if (part !== "" && part.length + 2 + p.length > max) {
      parts.push(part);
      part = p;
    } else {
      part = part === "" ? p : `${part}\n\n${p}`;
    }
  }
  if (part !== "") parts.push(part);
  return parts;
}

type Draft = Omit<Section, "ord">;

function buildSections(raw: RawSection[]): Section[] {
  const drafts: Draft[] = [];
  for (const s of raw) {
    const body = s.lines.join("\n").trim();
    if (s.heading === null && body === "") continue; // no text before the first heading
    const prev = drafts[drafts.length - 1];
    if (prev && s.headingLine !== null && body.length < MIN_SECTION_CHARS) {
      prev.body = [prev.body, s.headingLine, body].filter((t) => t !== "").join("\n\n");
      continue;
    }
    drafts.push({ level: s.level, heading: s.heading, anchor: s.anchor, body });
  }
  // Parts of a split section keep its heading and anchor: the anchor is a link target.
  return drafts
    .flatMap((d) => splitLong(d.body, MAX_SECTION_CHARS).map((body) => ({ ...d, body })))
    .map((d, ord) => ({ ord, ...d }));
}

/**
 * Parses Markdown text into metadata and sections. Pure: no I/O.
 * `fileName` is the title fallback (extension dropped).
 */
export function parseMarkdown(text: string, fileName: string): ParsedDoc {
  const warnings: string[] = [];
  const fm = splitFrontmatter(normalizeText(text));
  if (fm.unclosed) warnings.push("frontmatter not closed with '---', treated as body");
  const frontmatter = fm.raw === null ? null : parseFrontmatter(fm.raw, warnings);

  const { sections, h1 } = splitSections(fm.body);
  const title =
    frontmatterTitle(frontmatter?.title, warnings) ||
    h1 ||
    path.basename(fileName).replace(/\.md$/i, "").normalize("NFC");

  return {
    title,
    tags: toTags(frontmatter?.tags, warnings),
    frontmatter,
    sections: buildSections(sections),
    warnings,
  };
}
