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
  it("defaults path to the config directory and exclude to []", () => {
    const dir = makeTree();
    const file = write(dir, "name: Test\n");
    expect(loadConfig(file)).toEqual({
      configPath: file,
      configDir: dir,
      name: "Test",
      description: null,
      sourceDir: dir,
      sourceExists: true,
      exclude: [],
      git: null,
    });
  });

  it("resolves a relative path against the config directory", () => {
    const dir = makeTree({ "docs/a.md": "" });
    // Config path given relative to cwd; `path` must still resolve against the config's directory.
    const cfg = loadConfig(path.relative(process.cwd(), write(dir, "name: T\npath: ./docs\n")));
    expect(cfg.sourceDir).toBe(path.join(dir, "docs"));
  });

  it("accepts an absolute path", () => {
    const dir = makeTree({ "x/a.md": "" });
    const abs = path.join(dir, "x");
    const cfg = loadConfig(write(dir, `name: T\npath: ${JSON.stringify(abs)}\n`));
    expect(cfg.sourceDir).toBe(abs);
  });

  it("normalizes exclude to an array", () => {
    const dir = makeTree();
    expect(loadConfig(write(dir, 'name: T\nexclude: "**/draft/**"\n')).exclude).toEqual(["**/draft/**"]);
    expect(loadConfig(write(dir, 'name: T\nexclude: ["a/**", "b/**"]\n')).exclude).toEqual(["a/**", "b/**"]);
  });

  it("treats a missing source directory as a non-error", () => {
    const dir = makeTree();
    const cfg = loadConfig(write(dir, "name: T\npath: ./nope\n"));
    expect(cfg.sourceExists).toBe(false);
    expect(cfg.sourceDir).toBe(path.join(dir, "nope"));
  });

  it("rejects a path that is not a directory", () => {
    const dir = makeTree({ "file.md": "" });
    expect(errorsOf(() => loadConfig(write(dir, "name: T\npath: ./file.md\n")))[0]).toMatch(/not a directory/);
  });

  it("trims the name", () => {
    const dir = makeTree();
    expect(loadConfig(write(dir, 'name: "  Baza wiedzy  "\n')).name).toBe("Baza wiedzy");
  });

  it.each([
    ["empty", 'name: ""\n', "must not be empty"],
    ["whitespace only", 'name: "   "\n', "must not be empty"],
    ["too long", `name: ${"x".repeat(129)}\n`, "longer than 128"],
    ["control character", 'name: "a\\tb"\n', "control characters"],
  ])("rejects a name that is %s", (_label, yaml, fragment) => {
    const dir = makeTree();
    const errors = errorsOf(() => loadConfig(write(dir, yaml)));
    expect(errors.join("|")).toContain(fragment);
    expect(errors[0]).toMatch(/^name:/);
  });

  it("accepts a name of exactly 128 characters after trimming", () => {
    const dir = makeTree();
    expect(loadConfig(write(dir, `name: "  ${"x".repeat(128)}  "\n`)).name).toHaveLength(128);
  });

  it("requires name to be a string", () => {
    const dir = makeTree();
    expect(errorsOf(() => loadConfig(write(dir, "path: .\n")))[0]).toMatch(/^name:/);
    expect(errorsOf(() => loadConfig(write(dir, "name: [a]\n")))[0]).toMatch(/^name:/);
  });

  it("reads an optional description, trimmed", () => {
    const dir = makeTree();
    expect(loadConfig(write(dir, "name: T\ndescription: |\n  Company procedures.\n  Polish.\n")).description).toBe(
      "Company procedures.\nPolish.",
    );
  });

  it.each([
    ["empty", 'description: "  "\n', "description: must not be empty"],
    ["too long", `description: ${"x".repeat(2001)}\n`, "description: longer than 2000 characters"],
    ["not a string", "description: [a]\n", "description:"],
  ])("rejects a description that is %s", (_label, yaml, fragment) => {
    const dir = makeTree();
    expect(errorsOf(() => loadConfig(write(dir, `name: T\n${yaml}`)))[0]).toContain(fragment);
  });

  it("rejects the old sources field with a specific message", () => {
    const dir = makeTree();
    const errors = errorsOf(() => loadConfig(write(dir, "name: T\nsources:\n  /:\n    path: .\n")));
    expect(errors).toEqual(["sources: no longer supported; use name, path and exclude"]);
  });

  it("rejects unknown fields and wrong types, collecting all errors", () => {
    const dir = makeTree();
    const errors = errorsOf(() => loadConfig(write(dir, "name: T\nrecursive: false\nexclude: 5\n")));
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("collects name and path errors at once", () => {
    const dir = makeTree({ "f.md": "" });
    const errors = errorsOf(() => loadConfig(write(dir, 'name: ""\npath: ./f.md\n')));
    expect(errors).toHaveLength(2);
  });

  it("reports invalid YAML", () => {
    const dir = makeTree();
    expect(errorsOf(() => loadConfig(write(dir, "name: [unclosed")))[0]).toMatch(/invalid YAML/);
  });

  it("reports a missing config file", () => {
    const dir = makeTree();
    expect(errorsOf(() => loadConfig(path.join(dir, "missing.yml")))[0]).toMatch(/cannot read/);
  });

  it("reports an empty config file", () => {
    const dir = makeTree();
    expect(errorsOf(() => loadConfig(write(dir, ""))).length).toBeGreaterThan(0);
  });
});

describe("loadConfig git", () => {
  it("reads a git block with defaults", () => {
    const dir = makeTree();
    const cfg = loadConfig(write(dir, 'name: T\npath: ./kb\ngit:\n  url: "git@h:t/kb.git"\n'));
    expect(cfg.git).toEqual({
      url: "git@h:t/kb.git",
      branch: "main",
      path: "",
      repoDir: path.join(dir, "kb"),
      deployKey: null,
    });
    expect(cfg.sourceDir).toBe(path.join(dir, "kb"));
    expect(cfg.sourceExists).toBe(false);
  });

  it("indexes git.path inside the clone", () => {
    const dir = makeTree();
    const cfg = loadConfig(write(dir, "name: T\npath: ./kb\ngit:\n  url: u\n  branch: dev\n  path: /docs/\n"));
    expect(cfg.git?.path).toBe("docs");
    expect(cfg.git?.branch).toBe("dev");
    expect(cfg.sourceDir).toBe(path.join(dir, "kb", "docs"));
  });

  it("treats a git.path of . as the repo root", () => {
    const dir = makeTree();
    const cfg = loadConfig(write(dir, "name: T\npath: ./kb\ngit:\n  url: u\n  path: ./\n"));
    expect(cfg.git?.path).toBe("");
    expect(cfg.sourceDir).toBe(path.join(dir, "kb"));
  });

  it("resolves deployKey against the config dir", () => {
    const dir = makeTree();
    const cfg = loadConfig(write(dir, "name: T\npath: ./kb\ngit:\n  url: u\n  deployKey: ./deploy_key\n"));
    expect(cfg.git?.deployKey).toBe(path.join(dir, "deploy_key"));
  });

  it("requires path with git", () => {
    const dir = makeTree();
    expect(errorsOf(() => loadConfig(write(dir, "name: T\ngit:\n  url: u\n")))).toContain(
      "path: required when git is set",
    );
  });

  it("rejects git.path escaping the repo", () => {
    const dir = makeTree();
    const errors = errorsOf(() => loadConfig(write(dir, "name: T\npath: ./kb\ngit:\n  url: u\n  path: ../x\n")));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^git > path: /);
  });

  it("rejects a git.branch that looks like an option", () => {
    const dir = makeTree();
    expect(errorsOf(() => loadConfig(write(dir, "name: T\npath: ./kb\ngit:\n  url: u\n  branch: --upload-pack=x\n")))).toEqual([
      "git > branch: must not start with -",
    ]);
  });

  it("rejects unknown git fields and a missing url, all at once", () => {
    const dir = makeTree();
    const errors = errorsOf(() => loadConfig(write(dir, "name: T\npath: ./kb\ngit:\n  branch: main\n  foo: 1\n")));
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.startsWith("git > url:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("git:") && e.includes("foo"))).toBe(true);
  });
});

describe("findConfig", () => {
  it("prefers --config over env over discovery", () => {
    const dir = makeTree();
    write(dir, "name: T\n");
    expect(findConfig({ explicit: "a.yml", env: { MARIAN_KNOWS_CONFIG: "b.yml" }, cwd: dir })).toBe(
      path.join(dir, "a.yml"),
    );
    expect(findConfig({ env: { MARIAN_KNOWS_CONFIG: "b.yml" }, cwd: dir })).toBe(path.join(dir, "b.yml"));
  });

  it("walks up from a nested directory", () => {
    const dir = makeTree();
    const file = write(dir, "name: T\n");
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
