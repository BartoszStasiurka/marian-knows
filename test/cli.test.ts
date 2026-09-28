import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTree, runCli } from "./helpers.js";

/** Every file under dir with its content, for detecting side effects. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const full = path.join(e.parentPath, e.name);
    out[path.relative(dir, full)] = readFileSync(full, "utf8");
  }
  return out;
}

describe.concurrent("init", () => {
  it("creates ./marian-knows.yml in the current directory", async () => {
    const dir = makeTree();
    const r = await runCli(["init", "Baza wiedzy klienta"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(path.join(dir, "marian-knows.yml"));
    expect(snapshot(dir)).toEqual({ "marian-knows.yml": "name: Baza wiedzy klienta\n" });
  });

  it("creates the file given by --config", async () => {
    const dir = makeTree();
    mkdirSync(path.join(dir, "sub"));
    const r = await runCli(["--config", "sub/x.yml", "init", "P"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(snapshot(dir)).toEqual({ [path.join("sub", "x.yml")]: "name: P\n" });
  });

  it("never overwrites an existing file", async () => {
    const dir = makeTree();
    expect((await runCli(["init", "First"], { cwd: dir })).code).toBe(0);
    const r = await runCli(["init", "Second"], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/already exists/);
    expect(snapshot(dir)).toEqual({ "marian-knows.yml": "name: First\n" });
  });

  it("requires a valid project name", async () => {
    const dir = makeTree();
    expect((await runCli(["init"], { cwd: dir })).code).toBe(2);
    expect((await runCli(["init", "  "], { cwd: dir })).code).toBe(2);
    expect(snapshot(dir)).toEqual({});
  });
});

describe.concurrent("scan", () => {
  function project(): string {
    const dir = makeTree({
      "proj/docs/api/readme.md": "",
      "proj/docs/intro.md": "",
      "proj/docs/big.md": "a".repeat(1024 * 1024 + 1),
    });
    writeFileSync(path.join(dir, "proj", "marian-knows.yml"), "name: P\npath: ./docs\n");
    return dir;
  }

  it("prints virtual paths; warnings and summary go to stderr", async () => {
    const dir = project();
    const r = await runCli(["scan"], { cwd: path.join(dir, "proj", "docs", "api") }); // found by walking up
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("/api/readme.md\n/intro.md\n");
    expect(r.stderr).toContain("! warning: skipped /big.md: larger than 1 MB");
    expect(r.stderr).toContain("Files: 2");
  });

  it("uses the global --config from another directory", async () => {
    const dir = project();
    const r = await runCli(["--config", "proj/marian-knows.yml", "scan"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("/api/readme.md\n/intro.md\n");
  });

  it("--disk appends disk paths", async () => {
    const dir = project();
    const r = await runCli(["scan", "--disk", "--config", "proj/marian-knows.yml"], { cwd: dir });
    const docs = path.join(dir, "proj", "docs");
    expect(r.stdout).toBe(
      `/api/readme.md\t${path.join(docs, "api", "readme.md")}\n/intro.md\t${path.join(docs, "intro.md")}\n`,
    );
  });

  it("--json prints only a JSON array of virtual paths", async () => {
    const dir = project();
    const r = await runCli(["scan", "--json", "--config", "proj/marian-knows.yml"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([{ path: "/api/readme.md" }, { path: "/intro.md" }]);
  });

  it("--json --disk adds disk paths to each object", async () => {
    const dir = project();
    const r = await runCli(["scan", "--json", "--disk", "--config", "proj/marian-knows.yml"], { cwd: dir });
    const docs = path.join(dir, "proj", "docs");
    expect(JSON.parse(r.stdout)).toEqual([
      { path: "/api/readme.md", disk: path.join(docs, "api", "readme.md") },
      { path: "/intro.md", disk: path.join(docs, "intro.md") },
    ]);
  });

  it("warns, but succeeds, when the source directory is missing", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\npath: ./nope\n" });
    const r = await runCli(["scan"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("source directory does not exist");
  });

  it("rejects the old sources config with exit code 2", async () => {
    const dir = makeTree({ "marian-knows.yml": "sources:\n  /:\n    path: .\n" });
    const r = await runCli(["scan"], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("error: sources: no longer supported");
  });

  it("fails with exit code 2 when --config points nowhere", async () => {
    const dir = makeTree();
    expect((await runCli(["--config", "missing.yml", "scan"], { cwd: dir })).code).toBe(2);
  });
});

describe.concurrent("help and unknown commands", () => {
  it.each([["help"], ["--help"], ["-h"], ["scan", "--help"]].map((args) => ({ args })))(
    "$args prints usage and exits 0",
    async ({ args }) => {
      const r = await runCli(args, { cwd: makeTree() });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("Usage: marian-knows");
      expect(r.stdout).toContain("init <project_name>");
    },
  );

  it("prints usage and exits 2 without a command", async () => {
    const r = await runCli([], { cwd: makeTree() });
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("Usage: marian-knows");
  });

  it("rejects an unknown command with exit code 2", async () => {
    const r = await runCli(["reindex"], { cwd: makeTree() });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Unknown command: reindex");
  });
});

describe.concurrent("parse", () => {
  const md = "---\ntitle: Deploy\ntags: [ops]\n---\nIntro.\n\n## Backup\n" + "b".repeat(250) + "\n";

  it("prints metadata and sections without needing a config", async () => {
    const dir = makeTree({ "notes/deploy.md": md });
    const r = await runCli(["parse", "notes/deploy.md"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Title: Deploy\nTags: ops\n");
    expect(r.stdout).toContain('Frontmatter: {"title":"Deploy","tags":["ops"]}');
    expect(r.stdout).toContain("Sections: 2");
    expect(r.stdout).toContain("[0] (before first heading)  (6 chars)\n  Intro.");
    expect(r.stdout).toContain(`[1] ## Backup  #backup  (250 chars)\n  ${"b".repeat(80)}…`);
  });

  it("--json prints one object, warnings on stderr", async () => {
    const dir = makeTree({ "a.md": "---\n: [\n---\n# A\ntext" });
    const r = await runCli(["parse", "a.md", "--json"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      title: "A",
      tags: [],
      frontmatter: null,
      sections: [{ ord: 0, level: null, heading: null, anchor: null, body: "text" }],
    });
    expect(r.stderr).toMatch(/^! warning: broken frontmatter/);
  });

  it("fails with exit code 2 on a missing file or argument", async () => {
    const dir = makeTree();
    const missing = await runCli(["parse", "nope.md"], { cwd: dir });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("error: cannot read nope.md: ENOENT");
    expect((await runCli(["parse"], { cwd: dir })).code).toBe(2);
  });
});

describe.concurrent("stub commands", () => {
  it.each([
    ["index"],
    ["index", "--full"],
    ["search", "backup", "-n", "5", "--json"],
    ["list", "--json"],
    ["get", "/a.md"],
    ["status"],
    ["status", "--json"],
    ["destroy"],
    ["--config", "marian-knows.yml", "destroy"],
  ].map((args) => ({ args })))("$args has no side effects and exits 0", async ({ args }) => {
    const dir = makeTree({ "marian-knows.yml": "name: P\n", "a.md": "# A", "marian-knows.db": "x" });
    const before = snapshot(dir);
    const r = await runCli(args, { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("TODO: implementacja\n");
    expect(snapshot(dir)).toEqual(before);
  });

  it("works without any config", async () => {
    const r = await runCli(["status"], { cwd: makeTree() });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("TODO: implementacja\n");
  });
});
