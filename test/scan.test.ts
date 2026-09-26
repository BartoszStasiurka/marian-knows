import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, scanSource } from "../src/core/index.js";
import { makeTree } from "./helpers.js";

async function scan(dir: string, yaml: string) {
  const file = path.join(dir, "marian-knows.yml");
  writeFileSync(file, yaml);
  return scanSource(loadConfig(file));
}

const paths = (r: { files: { virtualPath: string }[] }) => r.files.map((f) => f.virtualPath);

/** True when the filesystem keeps names that differ only by case apart. */
function caseSensitiveFs(dir: string): boolean {
  const probe = path.join(dir, "probe");
  mkdirSync(probe);
  writeFileSync(path.join(probe, "a"), "");
  writeFileSync(path.join(probe, "A"), "");
  return readdirSync(probe).length === 2;
}

describe("scanSource", () => {
  it("scans recursively and maps paths relative to path", async () => {
    const dir = makeTree({ "docs/api/readme.md": "", "docs/a.md": "", "docs/x/y/z/deep.md": "" });
    const r = await scan(dir, "name: T\npath: ./docs\n");
    expect(paths(r)).toEqual(["/a.md", "/api/readme.md", "/x/y/z/deep.md"]);
    expect(r.files.find((f) => f.virtualPath === "/api/readme.md")!.diskPath).toBe(
      path.join(dir, "docs", "api", "readme.md"),
    );
    expect(r.warnings).toEqual([]);
  });

  it("defaults to the config directory", async () => {
    const dir = makeTree({ "README.md": "", "notes/n.md": "" });
    const r = await scan(dir, "name: T\n");
    expect(paths(r)).toEqual(["/README.md", "/notes/n.md"]);
  });

  it("picks up only .md files", async () => {
    const dir = makeTree({ "d/a.md": "", "d/b.txt": "", "d/c.markdown": "", "d/md": "" });
    const r = await scan(dir, "name: T\npath: ./d\n");
    expect(paths(r)).toEqual(["/a.md"]);
  });

  it("applies exclude globs relative to path", async () => {
    const dir = makeTree({
      "d/a.md": "",
      "d/draft/x.md": "",
      "d/sub/draft/y.md": "",
      "d/draft.md": "",
    });
    const r = await scan(dir, 'name: T\npath: ./d\nexclude: "**/draft/**"\n');
    expect(paths(r)).toEqual(["/a.md", "/draft.md"]);
  });

  it("anchors exclude globs at path, not at the config directory", async () => {
    const dir = makeTree({ "d/keep/a.md": "", "d/skip/b.md": "" });
    const r = await scan(dir, 'name: T\npath: ./d\nexclude: ["skip/**", "d/keep/**"]\n');
    expect(paths(r)).toEqual(["/keep/a.md"]);
  });

  it("always skips hidden entries and node_modules", async () => {
    const dir = makeTree({
      "d/a.md": "",
      "d/.hidden.md": "",
      "d/.git/x.md": "",
      "d/sub/.cache/y.md": "",
      "d/node_modules/pkg/readme.md": "",
      "d/sub/node_modules/z.md": "",
    });
    const r = await scan(dir, 'name: T\npath: ./d\nexclude: "nothing/**"\n');
    expect(paths(r)).toEqual(["/a.md"]);
  });

  it("skips files over 1 MB with a warning", async () => {
    const dir = makeTree({
      "d/small.md": "x",
      "d/edge.md": "a".repeat(1024 * 1024),
      "d/big.md": "a".repeat(1024 * 1024 + 1),
    });
    const r = await scan(dir, "name: T\npath: ./d\n");
    expect(paths(r)).toEqual(["/edge.md", "/small.md"]);
    expect(r.warnings).toEqual(["skipped /big.md: larger than 1 MB"]);
  });

  it("skips names containing # or ? with a warning", async () => {
    const dir = makeTree({ "d/ok.md": "", "d/c#.md": "" });
    let hasQuestion = true;
    try {
      writeFileSync(path.join(dir, "d", "what?.md"), "");
    } catch {
      hasQuestion = false; // e.g. Windows
    }
    const r = await scan(dir, "name: T\npath: ./d\n");
    expect(paths(r)).toEqual(["/ok.md"]);
    expect(r.warnings).toContain("skipped /c#.md: file name contains '#' or '?'");
    if (hasQuestion) expect(r.warnings).toContain("skipped /what?.md: file name contains '#' or '?'");
  });

  it("normalizes paths to NFC", async () => {
    const nfd = "zółw"; // "ó" as o + combining acute
    const dir = makeTree({ [`d/${nfd}/${nfd}.md`]: "" });
    const r = await scan(dir, "name: T\npath: ./d\n");
    expect(paths(r)).toEqual(["/zółw/zółw.md"]);
  });

  it("warns about a missing source directory", async () => {
    const dir = makeTree();
    const r = await scan(dir, "name: T\npath: ./nope\n");
    expect(r.files).toEqual([]);
    expect(r.warnings).toEqual([`source directory does not exist: ${path.join(dir, "nope")}`]);
  });

  it("returns nothing, without warnings, for an empty directory", async () => {
    const dir = makeTree({ "d/readme.txt": "" });
    const r = await scan(dir, "name: T\npath: ./d\n");
    expect(r).toEqual({ files: [], warnings: [] });
  });

  it("sorts output by code point order", async () => {
    const dir = makeTree({ "d/b.md": "", "d/a.md": "", "d/c/z.md": "", "d/Z.md": "" });
    const r = await scan(dir, "name: T\npath: ./d\n");
    expect(paths(r)).toEqual(["/Z.md", "/a.md", "/b.md", "/c/z.md"]);
  });
});

describe("case collisions", () => {
  it("keeps the first file name in code point order and warns", async () => {
    const dir = makeTree();
    if (!caseSensitiveFs(dir)) return;
    mkdirSync(path.join(dir, "d"));
    writeFileSync(path.join(dir, "d", "a.md"), "1");
    writeFileSync(path.join(dir, "d", "A.md"), "2");
    const r = await scan(dir, "name: T\npath: ./d\n");
    expect(paths(r)).toEqual(["/A.md"]);
    expect(r.warnings).toEqual(["skipped /a.md: name differs only by case from /A.md"]);
  });

  it("detects collisions through directory names", async () => {
    const dir = makeTree();
    if (!caseSensitiveFs(dir)) return;
    mkdirSync(path.join(dir, "d", "Notes"), { recursive: true });
    mkdirSync(path.join(dir, "d", "notes"));
    writeFileSync(path.join(dir, "d", "Notes", "x.md"), "");
    writeFileSync(path.join(dir, "d", "notes", "x.md"), "");
    writeFileSync(path.join(dir, "d", "notes", "y.md"), "");
    const r = await scan(dir, "name: T\npath: ./d\n");
    expect(paths(r)).toEqual(["/Notes/x.md", "/notes/y.md"]);
    expect(r.warnings).toEqual(["skipped /notes/x.md: name differs only by case from /Notes/x.md"]);
  });
});
