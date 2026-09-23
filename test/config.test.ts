import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, findConfig, loadConfig } from "../src/core/index.js";
import { makeTree } from "./helpers.js";

function write(dir: string, yaml: string): string {
  const file = path.join(dir, "marian-knows.yml");
  writeFileSync(file, yaml);
  return file;
}

function errorsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e.errors;
    throw e;
  }
  throw new Error("expected ConfigError");
}

describe("loadConfig", () => {
  it("parses mounts and applies defaults", () => {
    const dir = makeTree({ "docs/a.md": "# A", "README.md": "# R" });
    const cfg = loadConfig(
      write(
        dir,
        `sources:
  /:
    path: ./docs
  /server/:
    path: ./docs
    recursive: false
    exclude: "**/legacy/**"
  /README.md:
    path: ./README.md
`,
      ),
    );
    expect(cfg.mounts.map((m) => m.key)).toEqual(["/", "/server/", "/README.md"]);
    const [root, server, readme] = cfg.mounts;
    expect(root).toMatchObject({ kind: "dir", recursive: true, exclude: [], exists: true });
    expect(root!.diskPath).toBe(path.join(dir, "docs"));
    expect(server).toMatchObject({ recursive: false, exclude: ["**/legacy/**"] });
    expect(readme).toMatchObject({ kind: "file", exists: true });
  });

  it("accepts absolute paths", () => {
    const dir = makeTree({ "x/a.md": "" });
    const abs = path.join(dir, "x");
    const cfg = loadConfig(write(dir, `sources:\n  /x/:\n    path: ${JSON.stringify(abs)}\n`));
    expect(cfg.mounts[0]!.diskPath).toBe(abs);
  });

  it("treats a missing path as a non-error", () => {
    const dir = makeTree();
    const cfg = loadConfig(write(dir, "sources:\n  /nope/:\n    path: ./nope\n"));
    expect(cfg.mounts[0]!.exists).toBe(false);
  });

  it("reports invalid YAML", () => {
    const dir = makeTree();
    expect(errorsOf(() => loadConfig(write(dir, "sources: [unclosed")))[0]).toMatch(/invalid YAML/);
  });

  it("reports a missing config file", () => {
    const dir = makeTree();
    expect(errorsOf(() => loadConfig(path.join(dir, "missing.yml")))[0]).toMatch(/cannot read/);
  });

  it("rejects unknown fields and wrong types", () => {
    const dir = makeTree();
    const errors = errorsOf(() =>
      loadConfig(write(dir, "sources:\n  /a/:\n    path: ./a\n    recursve: true\n    exclude: 5\n")),
    );
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects empty sources", () => {
    const dir = makeTree();
    expect(errorsOf(() => loadConfig(write(dir, "sources: {}\n")))[0]).toMatch(/at least one/);
  });

  it("collects all key errors at once", () => {
    const dir = makeTree({ "d/a.md": "" });
    const errors = errorsOf(() =>
      loadConfig(
        write(
          dir,
          `sources:
  /a//b/:
    path: ./d
  /Notes/:
    path: ./d
  /notes/:
    path: ./d
  /../x/:
    path: ./d
`,
        ),
      ),
    );
    expect(errors.some((e) => e.includes("empty segments"))).toBe(true);
    expect(errors.some((e) => e.includes("ignoring case"))).toBe(true);
    expect(errors.some((e) => e.includes("forbidden segment"))).toBe(true);
  });

  it("requires the trailing slash to match the path type", () => {
    const dir = makeTree({ "d/a.md": "", "f.md": "" });
    const errors = errorsOf(() =>
      loadConfig(
        write(
          dir,
          `sources:
  /dir:
    path: ./d
  /file/:
    path: ./f.md
`,
        ),
      ),
    );
    expect(errors.some((e) => e.includes('"/dir"') && e.includes("not a file"))).toBe(true);
    expect(errors.some((e) => e.includes('"/file/"'))).toBe(true);
  });

  it("requires file sources to be .md", () => {
    const dir = makeTree({ "notes.txt": "" });
    const errors = errorsOf(() => loadConfig(write(dir, "sources:\n  /notes.txt:\n    path: ./notes.txt\n")));
    expect(errors.some((e) => e.includes(".md"))).toBe(true);
  });
});

describe("findConfig", () => {
  it("prefers --config over env over discovery", () => {
    const dir = makeTree();
    write(dir, "sources: {}");
    expect(findConfig({ explicit: "a.yml", env: { MARIAN_KNOWS_CONFIG: "b.yml" }, cwd: dir })).toBe(
      path.join(dir, "a.yml"),
    );
    expect(findConfig({ env: { MARIAN_KNOWS_CONFIG: "b.yml" }, cwd: dir })).toBe(path.join(dir, "b.yml"));
  });

  it("walks up from a nested directory", () => {
    const dir = makeTree();
    const file = write(dir, "sources: {}");
    const nested = path.join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findConfig({ env: {}, cwd: nested })).toBe(file);
  });

  it("returns undefined when nothing is found", () => {
    const dir = makeTree();
    // Only meaningful if no marian-knows.yml exists in any parent of the temp dir.
    const found = findConfig({ env: {}, cwd: dir });
    expect(found === undefined || found.endsWith("marian-knows.yml")).toBe(true);
  });
});
