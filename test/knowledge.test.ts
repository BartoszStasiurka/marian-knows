import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { list, loadConfig, parseFile, rebuildIndex, type LoadedConfig } from "../src/core/index.js";
import { makeTree } from "./helpers.js";
import { TOP_K, evaluate, formatReport, loadQueries } from "./quality.js";

/** The product's own documentation, served by the repo's marian-knows.yml. */
const KNOWLEDGE = fileURLToPath(new URL("../knowledge/", import.meta.url));

/** Tag vocabulary from knowledge/README.md: one type and at least one area per file (README files may skip the area). */
const TYPES = ["getting-started", "guide", "concept", "reference", "troubleshooting"];
const AREAS = ["cli", "config", "search", "index", "mcp", "http", "git", "security", "logs"];

const MIN_HIT_RATE = 1;
const MIN_MRR = 0.9;

/** Copies knowledge/ into a temp dir and indexes it, so the test never writes into the repo. */
async function indexKnowledge(): Promise<{ config: LoadedConfig; warnings: string[] }> {
  const dir = makeTree();
  writeFileSync(path.join(dir, "marian-knows.yml"), "name: Knowledge\npath: ./knowledge\n");
  cpSync(KNOWLEDGE, path.join(dir, "knowledge"), { recursive: true });
  const config = loadConfig(path.join(dir, "marian-knows.yml"));
  const { warnings } = await rebuildIndex(config);
  return { config, warnings };
}

const diskPath = (virtual: string) => path.join(KNOWLEDGE, virtual);

/** Relative Markdown links outside code blocks: `[text](target)`, external URLs left out. */
function links(markdown: string): string[] {
  const prose = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((t) => !/^[a-z]+:/i.test(t));
}

describe("knowledge base", () => {
  it("indexes without warnings", async () => {
    const { config, warnings } = await indexKnowledge();
    expect(warnings).toEqual([]);
    expect(list(config).docs.length).toBeGreaterThan(20);
  });

  it("every file has a title and tags from the vocabulary", async () => {
    const { config } = await indexKnowledge();
    for (const { path: p } of list(config).docs) {
      const doc = parseFile(diskPath(p));
      expect(doc.frontmatter?.title, `${p}: title`).toBeTypeOf("string");
      expect(doc.tags.filter((t) => TYPES.includes(t)), `${p}: type tag`).toHaveLength(1);
      if (!p.endsWith("/README.md")) {
        expect(doc.tags.some((t) => AREAS.includes(t)), `${p}: area tag`).toBe(true);
      }
      for (const t of doc.tags) expect([...TYPES, ...AREAS], `${p}: tag ${t}`).toContain(t);
    }
  });

  it("relative links point to existing files and anchors", async () => {
    const { config } = await indexKnowledge();
    for (const { path: p } of list(config).docs) {
      for (const target of links(readFileSync(diskPath(p), "utf8"))) {
        const [file, anchor] = target.split("#");
        const resolved = file ? path.resolve(path.dirname(diskPath(p)), file) : diskPath(p);
        expect(existsSync(resolved), `${p} -> ${target}`).toBe(true);
        if (anchor && resolved.endsWith(".md")) {
          const anchors = parseFile(resolved).sections.map((s) => s.anchor);
          expect(anchors, `${p} -> ${target}`).toContain(anchor);
        }
      }
    }
  });

  it(`product questions: hit@${TOP_K} and MRR stay above the floors`, async () => {
    const { config } = await indexKnowledge();
    const queries = loadQueries("queries-knowledge.yml");
    const indexed = new Set(list(config).docs.map((d) => d.path));
    for (const q of queries) for (const p of q.expect) expect(indexed, `${q.query}: ${p}`).toContain(p);

    const report = evaluate(config, queries);
    console.log(formatReport(report, "knowledge queries"));
    expect(report.hitRate).toBeGreaterThanOrEqual(MIN_HIT_RATE);
    expect(report.mrr).toBeGreaterThanOrEqual(MIN_MRR);
  });
});
