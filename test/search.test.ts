import Database from "better-sqlite3";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  IndexMissingError,
  indexPath,
  loadConfig,
  prepareQuery,
  rebuildIndex,
  search,
  type SearchOptions,
} from "../src/core/index.js";
import { makeTree } from "./helpers.js";

/** Filler that keeps sections above the merge threshold and matches nothing below. */
const PAD = "Lorem ipsum dolor sit amet consectetur. ".repeat(6);

async function indexed(files: Record<string, string>) {
  const dir = makeTree({ ...files, "marian-knows.yml": "name: T\n" });
  const config = loadConfig(path.join(dir, "marian-knows.yml"));
  await rebuildIndex(config);
  return { dir, config, find: (q: string, o?: SearchOptions) => search(config, q, o) };
}

const paths = (hits: { path: string }[]) => hits.map((h) => h.path);

describe("prepareQuery", () => {
  it("trims words longer than 5 chars by 2 and matches every term as a prefix", () => {
    expect(prepareQuery("konfiguracja serwer api")).toMatchObject({
      words: ["konfiguracja", "serwer", "api"],
      and: `"konfigurac"* "serw"* "api"*`,
      or: `"konfigurac"* OR "serw"* OR "api"*`,
    });
  });

  it("strips FTS5 syntax: quotes, stars, parentheses, column filters, NEAR", () => {
    expect(prepareQuery(`"foo" AND bar* (baz) title:qux NEAR/2 -x ^y`, { exact: true }).and).toBe(
      `"foo" "bar" "baz" "title" "qux" "near" "2" "x" "y"`,
    );
  });

  it("--exact: no trimming, no prefix", () => {
    expect(prepareQuery("Konfiguracja", { exact: true }).and).toBe(`"konfiguracja"`);
  });

  it("drops stop words, but keeps them when nothing else is left", () => {
    expect(prepareQuery("jak ustawić backup w serwerze").words).toEqual(["ustawić", "backup", "serwerze"]);
    expect(prepareQuery("the and of the").words).toEqual(["the", "and", "of", "the"]);
  });

  it("folds ł and normalizes to NFC", () => {
    expect(prepareQuery("Łódź żółw", { exact: true }).words).toEqual(["lódź", "żólw"]);
    expect(prepareQuery("zólw", { exact: true }).words).toEqual(["zólw"]);
  });

  it("no searchable words", () => {
    expect(prepareQuery(" ?! ** ")).toEqual({ words: [], and: null, or: null });
  });
});

describe("search", () => {
  it("returns files ranked by their best section, with its anchor", async () => {
    const { find } = await indexed({
      "a.md": `# A\n\n${PAD}\n\n## Intro\n\n${PAD}\n\n## Backup bazy\n\nCodzienny backup. ${PAD}\n`,
      "b.md": `# B\n\nWspominamy backup raz. ${PAD}\n`,
      "c.md": `# C\n\n${PAD}\n`,
    });
    const hits = find("backup");
    expect(paths(hits)).toEqual(["/a.md", "/b.md"]);
    expect(hits[0]).toMatchObject({ title: "A", tags: [], anchor: "backup-bazy", snippet: null });
    expect(hits[1]!.anchor).toBeNull();
    expect(hits[0]!.score).toBeLessThan(hits[1]!.score);
  });

  it("weights title and tags over body", async () => {
    const { find } = await indexed({
      "body.md": `# Notatki\n\nTu jest mowa o kubernetes. ${PAD}\n`,
      "title.md": `# Kubernetes\n\n${PAD}\n`,
      "tag.md": `---\ntags: [kubernetes]\n---\n# Inne\n\n${PAD}\n`,
    });
    expect(paths(find("kubernetes"))).toEqual(["/title.md", "/tag.md", "/body.md"]);
  });

  it("matches inflected forms by prefix; --exact does not", async () => {
    const { find } = await indexed({ "a.md": `# A\n\nOpis konfiguracji serwera. ${PAD}\n` });
    expect(paths(find("konfiguracja"))).toEqual(["/a.md"]);
    expect(paths(find("serwer"))).toEqual(["/a.md"]);
    expect(find("konfiguracja", { exact: true })).toEqual([]);
    expect(paths(find("konfiguracji", { exact: true }))).toEqual(["/a.md"]);
  });

  it("finds words without Polish diacritics, including ł", async () => {
    const { find } = await indexed({
      "zolw.md": `# Zwierzęta\n\nŻółw jest powolny. ${PAD}\n`,
      "lodz.md": `# Miasta\n\nŁódź leży w centrum. ${PAD}\n`,
    });
    expect(paths(find("zolw"))).toEqual(["/zolw.md"]);
    expect(paths(find("lodz"))).toEqual(["/lodz.md"]);
    expect(paths(find("ŻÓŁW", { exact: true }))).toEqual(["/zolw.md"]);
  });

  it("keeps the original text in docs and sections", async () => {
    const { config } = await indexed({ "a.md": `# Łódź\n\n## Żółw\n\nŁódź i żółw. ${PAD}\n` });
    const db = new Database(indexPath(config), { readonly: true });
    const row = db.prepare("SELECT d.title, s.heading, s.body FROM sections s JOIN docs d ON d.id = s.doc_id").get();
    db.close();
    expect(row).toMatchObject({ title: "Łódź", heading: "Żółw", body: expect.stringContaining("Łódź i żółw.") });
  });

  it("ANDs words; falls back to OR below 3 results, strict results first", async () => {
    const { find } = await indexed({
      "both.md": `# X\n\nbackup i monitoring. ${PAD}\n`,
      "backup.md": `# Y\n\nsam backup tutaj, backup. ${PAD}\n`,
      "mon.md": `# Z\n\nsam monitoring. ${PAD}\n`,
    });
    const hits = paths(find("backup monitoring"));
    expect(hits[0]).toBe("/both.md");
    expect(hits.slice(1).sort()).toEqual(["/backup.md", "/mon.md"]);
    expect(paths(find("backup monitoring", { exact: true }))).toEqual(["/both.md"]);
  });

  it("no OR fallback for a single meaningful word or with enough strict results", async () => {
    const { find } = await indexed({
      "1.md": `# A\n\nalfa beta. ${PAD}\n`,
      "2.md": `# B\n\nalfa beta. ${PAD}\n`,
      "3.md": `# C\n\nalfa beta. ${PAD}\n`,
      "4.md": `# D\n\ntylko alfa. ${PAD}\n`,
    });
    expect(paths(find("alfa beta")).sort()).toEqual(["/1.md", "/2.md", "/3.md"]);
    expect(paths(find("w beta")).sort()).toEqual(["/1.md", "/2.md", "/3.md"]);
  });

  it("ignores stop words in AND mode", async () => {
    const { find } = await indexed({ "a.md": `# A\n\nbackup bazy danych. ${PAD}\n` });
    expect(paths(find("jak zrobić backup", { exact: true }))).toEqual([]);
    expect(paths(find("jak backup"))).toEqual(["/a.md"]);
  });

  it("FTS5 syntax in the query is harmless", async () => {
    const { find } = await indexed({ "a.md": `# A\n\nbackup NOT restore. ${PAD}\n` });
    expect(paths(find(`backup" OR (`))).toEqual(["/a.md"]);
    expect(paths(find("NOT backup"))).toEqual(["/a.md"]);
    expect(find("*** ???")).toEqual([]);
  });

  it("--tag filters by file tag, case-insensitively, before the limit", async () => {
    const { find } = await indexed({
      "a.md": `---\ntags: [ops]\n---\n# A\n\nbackup backup backup. ${PAD}\n`,
      "b.md": `---\ntags: [Dev, ops]\n---\n# B\n\nbackup. ${PAD}\n`,
    });
    expect(paths(find("backup", { tag: "dev" }))).toEqual(["/b.md"]);
    expect(paths(find("backup", { tag: "ops", limit: 1 }))).toHaveLength(1);
    expect(find("backup", { tag: "nope" })).toEqual([]);
  });

  it("-n limits the number of files, not sections", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`f${i}.md`] = `# F\n\n## S1\n\nbackup ${PAD}\n\n## S2\n\nbackup ${PAD}\n`;
    const { find } = await indexed(files);
    expect(find("backup")).toHaveLength(10);
    expect(find("backup", { limit: 3 })).toHaveLength(3);
    expect(new Set(paths(find("backup", { limit: 12 }))).size).toBe(12);
  });

  it("snippets highlight matches in the original text", async () => {
    const { find } = await indexed({
      "a.md": `# A\n\n${PAD}Ten żółw robi codzienny backup bazy o 03:00. ${PAD}\n`,
    });
    const [hit] = find("zolw backup", { snippets: true });
    expect(hit!.snippet).toMatch(/^….*Ten \[żółw\] robi codzienny \[backup\] bazy o 03:00\..*…$/);
    expect(hit!.snippet!.length).toBeLessThan(260);
  });

  it("snippet of a short section is not cut", async () => {
    const { find } = await indexed({ "a.md": "Krótki backup." });
    expect(find("backup", { snippets: true })[0]!.snippet).toBe("Krótki [backup].");
  });

  it("missing or outdated index is IndexMissingError", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: T\n", "a.md": "a" });
    const config = loadConfig(path.join(dir, "marian-knows.yml"));
    expect(() => search(config, "a")).toThrow(IndexMissingError);
    expect(() => search(config, "?!")).toThrow(IndexMissingError);

    await rebuildIndex(config);
    const db = new Database(indexPath(config));
    db.prepare("UPDATE meta SET value = 'old' WHERE key = 'schema_version'").run();
    db.close();
    expect(() => search(config, "a")).toThrow("Brak indeksu. Uruchom: marian-knows index");
  });
});
