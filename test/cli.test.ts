import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
    expect(r.stderr).toContain("error: unknown command: reindex");
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

describe.concurrent("index", () => {
  it("builds the index next to the config and prints a summary", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\npath: ./docs\n", "docs/a.md": "# A", "docs/b/c.md": "c" });
    mkdirSync(path.join(dir, "sub"));
    const r = await runCli(["index"], { cwd: path.join(dir, "sub") });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Files: 2\n\+ 2 added, ~ 0 changed, - 0 removed \(\d+\.\d s\)\n$/);
    expect(r.stderr).toBe("");
    expect(readdirSync(path.join(dir, ".marian-knows"))).toContain("index.db");
  });

  it("reports changes on the next run and warnings on stderr", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\n", "a.md": "a", "b.md": "b" });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    writeFileSync(path.join(dir, "a.md"), "---\n: [\n---\nnew");
    writeFileSync(path.join(dir, "c.md"), "c");
    const r = await runCli(["index"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("+ 1 added, ~ 1 changed, - 0 removed");
    expect(r.stderr).toMatch(/^! warning: \/a\.md: broken frontmatter/);
  });

  it("--full rebuilds and reports changes against the old index", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\n", "a.md": "a" });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    const r = await runCli(["index", "--full"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Files: 1\n+ 0 added, ~ 0 changed, - 0 removed");
  });

  it("fails with exit 2 while another index run holds the lock", async () => {
    // The test runner's own pid is alive for the whole subprocess run.
    const dir = makeTree({ "marian-knows.yml": "name: P\n", "a.md": "a", ".marian-knows/index.lock": String(process.pid) });
    const r = await runCli(["index"], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(`error: index is already running (pid ${process.pid})\n`);
    expect(r.stdout).toBe("");
  });

  it("fails with exit 2 without a config and creates nothing", async () => {
    const dir = makeTree({ "a.md": "a" });
    const r = await runCli(["index"], { cwd: dir });
    expect(r.code).toBe(2);
    expect(snapshot(dir)).toEqual({ "a.md": "a" });
  });
});

describe.concurrent("search", () => {
  const PAD = "Lorem ipsum dolor sit amet consectetur. ".repeat(6);

  async function project(): Promise<string> {
    const dir = makeTree({
      "marian-knows.yml": "name: P\n",
      "server/deploy.md": `---\ntitle: Deploy\ntags: [ops]\n---\n${PAD}\n\n## Harmonogram\n\n${PAD}codzienny backup bazy o 03:00. ${PAD}\n`,
      "notes.md": `# Notatki\n\nOpis konfiguracji i backup. ${PAD}\n`,
    });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    return dir;
  }

  it("prints one virtual path per line in rank order", async () => {
    const dir = await project();
    const r = await runCli(["search", "backup"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n").filter(Boolean).sort()).toEqual(["/notes.md", "/server/deploy.md"]);
    expect(r.stderr).toBe("");
  });

  it("joins several positionals into one query; -n, --tag, --exact", async () => {
    const dir = await project();
    const run = (...args: string[]) => runCli(["search", ...args], { cwd: dir });
    const [multi, limited, tagged, prefix, exact] = await Promise.all([
      run("codzienny", "backup"),
      run("backup", "-n", "1"),
      run("backup", "--tag", "ops"),
      run("konfiguracja"),
      run("konfiguracja", "--exact"),
    ]);
    // One strict hit, so OR results follow it.
    expect(multi.stdout).toBe("/server/deploy.md\n/notes.md\n");
    expect(limited.stdout.split("\n")).toHaveLength(2);
    expect(tagged.stdout).toBe("/server/deploy.md\n");
    expect(prefix.stdout).toBe("/notes.md\n");
    expect(exact.code).toBe(1);
  });

  it("--snippets prints the snippet indented under the path", async () => {
    const dir = await project();
    const r = await runCli(["search", "codzienny", "--snippets"], { cwd: dir });
    expect(r.code).toBe(0);
    const [p, snippet] = r.stdout.split("\n");
    expect(p).toBe("/server/deploy.md");
    expect(snippet).toMatch(/^  ….*\[codzienny\] backup bazy o 03:00\..*…$/);
  });

  it("exits 1 with empty output on no results", async () => {
    const dir = await project();
    const r = await runCli(["search", "nieistniejące"], { cwd: dir });
    expect(r).toMatchObject({ code: 1, stdout: "", stderr: "" });
  });

  it("missing index: message and exit 2", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\n", "a.md": "a" });
    const r = await runCli(["search", "a"], { cwd: dir });
    expect(r).toMatchObject({ code: 2, stdout: "", stderr: "No index. Run: marian-knows index\n" });
    expect(snapshot(dir)).toEqual({ "marian-knows.yml": "name: P\n", "a.md": "a" });
  });

  it("usage errors exit 2", async () => {
    const dir = await project();
    const [missing, negative, ...bad] = await Promise.all([
      runCli(["search"], { cwd: dir }),
      runCli(["search", "backup", "-n", "-1"], { cwd: dir }),
      ...["0", "x", "1.5"].map((n) => runCli(["search", "backup", "-n", n], { cwd: dir })),
    ]);
    expect(missing.code).toBe(2);
    expect(negative.code).toBe(2);
    for (const r of bad) {
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/-n expects a positive integer/);
    }
  });
});

describe.concurrent("search --json and scope", () => {
  const PAD = "Lorem ipsum dolor sit amet consectetur. ".repeat(6);

  async function project(): Promise<string> {
    const dir = makeTree({
      "marian-knows.yml": "name: P\n",
      "server/deploy.md": `---\ntitle: Deploy\ntags: [ops]\n---\n${PAD}\n\n## Harmonogram\n\n${PAD}codzienny backup bazy. ${PAD}\n`,
      "server/draft/old.md": `# Old\n\nbackup. ${PAD}\n`,
      "serverx/x.md": `# X\n\nbackup. ${PAD}\n`,
      "notes.md": `# Notatki\n\nbackup. ${PAD}\n`,
    });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    return dir;
  }

  it("--json prints a bare array with every field, snippet null without --snippets", async () => {
    const dir = await project();
    const r = await runCli(["search", "codzienny", "--json"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const hits = JSON.parse(r.stdout);
    expect(hits).toEqual([
      { path: "/server/deploy.md", title: "Deploy", tags: ["ops"], score: expect.any(Number), anchor: "harmonogram", heading: "Harmonogram", snippet: null },
    ]);
    const withSnippet = JSON.parse((await runCli(["search", "codzienny", "--json", "--snippets"], { cwd: dir })).stdout);
    expect(withSnippet[0].snippet).toContain("[codzienny]");
  });

  it("--json with no results prints [] and exits 1", async () => {
    const dir = await project();
    expect(await runCli(["search", "nieistniejące", "--json"], { cwd: dir })).toMatchObject({ code: 1, stdout: "[]\n", stderr: "" });
  });

  it("--path and --exclude-path are repeatable", async () => {
    const dir = await project();
    const run = (...args: string[]) => runCli(["search", "backup", ...args], { cwd: dir });
    const [sub, file, both] = await Promise.all([
      run("--path", "/server/"),
      run("--path", "/notes.md"),
      run("--path", "/server/", "--path", "/notes.md", "--exclude-path", "/server/draft/"),
    ]);
    expect(sub.stdout.split("\n").filter(Boolean).sort()).toEqual(["/server/deploy.md", "/server/draft/old.md"]);
    expect(file.stdout).toBe("/notes.md\n");
    expect(both.stdout.split("\n").filter(Boolean).sort()).toEqual(["/notes.md", "/server/deploy.md"]);
  });

  it("valid scope without files: warning on stderr, exit 1; --json keeps stdout clean", async () => {
    const dir = await project();
    const r = await runCli(["search", "backup", "--path", "/nope/", "--json"], { cwd: dir });
    expect(r).toMatchObject({ code: 1, stdout: "[]\n", stderr: "! warning: no indexed files under /nope/\n" });
  });

  it("invalid scope path: exit 2, nothing on stdout", async () => {
    const dir = await project();
    const [rel, dots] = await Promise.all([
      runCli(["search", "backup", "--path", "server/"], { cwd: dir }),
      runCli(["search", "backup", "--exclude-path", "/a/../b/"], { cwd: dir }),
    ]);
    expect(rel).toMatchObject({ code: 2, stdout: "" });
    expect(rel.stderr).toBe("error: invalid path 'server/': must start with '/'\n");
    expect(dots.code).toBe(2);
    expect(dots.stderr).toContain("forbidden segment '..'");
  });
});

describe.concurrent("list", () => {
  async function project(): Promise<string> {
    const dir = makeTree({
      "marian-knows.yml": "name: P\n",
      "b.md": "---\ntags: [ops]\n---\n# B\n",
      "a/x.md": "# X",
      "a/draft/y.md": "---\ntags: [Ops]\n---\ny",
    });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    return dir;
  }

  it("prints indexed files sorted by path", async () => {
    const dir = await project();
    expect(await runCli(["list"], { cwd: dir })).toMatchObject({ code: 0, stdout: "/a/draft/y.md\n/a/x.md\n/b.md\n", stderr: "" });
  });

  it("--json, --tag, --path, --exclude-path", async () => {
    const dir = await project();
    const r = await runCli(["list", "--json", "--tag", "ops", "--path", "/a/", "--path", "/b.md"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([
      { path: "/a/draft/y.md", title: "y", tags: ["Ops"] },
      { path: "/b.md", title: "B", tags: ["ops"] },
    ]);
    const excluded = await runCli(["list", "--exclude-path", "/a/draft/"], { cwd: dir });
    expect(excluded.stdout).toBe("/a/x.md\n/b.md\n");
  });

  it("no files: exit 1 ([] with --json); scope warning on stderr", async () => {
    const dir = await project();
    const [tag, scope] = await Promise.all([
      runCli(["list", "--tag", "nope"], { cwd: dir }),
      runCli(["list", "--json", "--path", "/c.md"], { cwd: dir }),
    ]);
    expect(tag).toMatchObject({ code: 1, stdout: "", stderr: "" });
    expect(scope).toMatchObject({ code: 1, stdout: "[]\n", stderr: "! warning: not in the index: /c.md\n" });
  });

  it("missing index or invalid path: exit 2", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\n", "a.md": "a" });
    expect(await runCli(["list"], { cwd: dir })).toMatchObject({ code: 2, stderr: "No index. Run: marian-knows index\n" });
    expect((await runCli(["list", "--path", "/a//"], { cwd: dir })).code).toBe(2);
  });
});

describe.concurrent("get", () => {
  it("prints the file content as on disk", async () => {
    const content = "# Deploy\r\n\r\nKrok 1.\r\n";
    const dir = makeTree({ "marian-knows.yml": "name: P\npath: ./docs\n", "docs/server/deploy.md": content });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    expect(await runCli(["get", "/server/deploy.md"], { cwd: dir })).toMatchObject({ code: 0, stdout: content, stderr: "" });
  });

  it("exit 2: invalid path, directory, not indexed, outside the source directory, missing argument", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\npath: ./docs\n", "docs/a.md": "a", "secret.md": "s" });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    const cases = await Promise.all(
      [["/../secret.md"], ["a.md"], ["/docs/"], ["/secret.md"], ["/marian-knows.yml"], []].map((a) =>
        runCli(["get", ...a], { cwd: dir }),
      ),
    );
    for (const r of cases) expect(r).toMatchObject({ code: 2, stdout: "" });
    expect(cases[0]!.stderr).toContain("forbidden segment '..'");
    expect(cases[2]!.stderr).toContain("must be a file path, not a directory");
    expect(cases[3]!.stderr).toBe("error: not in the index: /secret.md\n");
  });
});

describe.concurrent("get sections and limits", () => {
  const PAD = "Lorem ipsum dolor sit amet consectetur. ".repeat(6);

  async function project(): Promise<string> {
    const dir = makeTree({
      "marian-knows.yml": "name: P\n",
      "deploy.md": `# Deploy\n\n## Backup bazy\n\nKopia o 03:00. ${PAD}\n\n## Restore\n\nOdtwarzanie. ${PAD}\n`,
    });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    return dir;
  }

  it("get <path>#<anchor> prints one section", async () => {
    const dir = await project();
    expect(await runCli(["get", "/deploy.md#restore"], { cwd: dir })).toMatchObject({
      code: 0,
      stdout: `## Restore\n\nOdtwarzanie. ${PAD.trim()}\n`,
      stderr: "",
    });
  });

  it("unknown or empty anchor: exit 2", async () => {
    const dir = await project();
    const [unknown, empty] = await Promise.all([
      runCli(["get", "/deploy.md#nope"], { cwd: dir }),
      runCli(["get", "/deploy.md#"], { cwd: dir }),
    ]);
    expect(unknown).toMatchObject({
      code: 2,
      stdout: "",
      stderr: "error: no section #nope in /deploy.md; anchors: #backup-bazy, #restore\n",
    });
    expect(empty).toMatchObject({ code: 2, stdout: "" });
    expect(empty.stderr).toContain("empty anchor after '#'");
  });

  it("--max-chars cuts the output with a notice; 0 = whole file; bad value: exit 2", async () => {
    const dir = await project();
    const [cut, whole, bad] = await Promise.all([
      runCli(["get", "/deploy.md", "--max-chars", "100"], { cwd: dir }),
      runCli(["get", "/deploy.md", "--max-chars", "0"], { cwd: dir }),
      runCli(["get", "/deploy.md", "--max-chars", "-1"], { cwd: dir }),
    ]);
    expect(cut.code).toBe(0);
    expect(cut.stdout).toMatch(/\n\n\[truncated: showed \d+ of \d+ characters\. Read one section with get \/deploy\.md#<anchor>\. Anchors: #backup-bazy, #restore\.\]\n$/);
    expect(whole.stdout).toBe(readFileSync(path.join(dir, "deploy.md"), "utf8"));
    expect(bad.code).toBe(2);
  });
});

describe.concurrent("query log", () => {
  async function project(): Promise<string> {
    const dir = makeTree({ "marian-knows.yml": "name: P\n", "a.md": "# A\n\n## Backup\n\nbackup bazy\n", "b.md": "# B" });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    return dir;
  }

  it("search, get and list are logged; log prints them, --zero and --json filter and format", async () => {
    const dir = await project();
    const opts = { cwd: dir, log: true };
    await runCli(["search", "backup", "--tag", "x"], opts);
    await runCli(["search", "backup"], opts);
    await runCli(["get", "/a.md#backup"], opts);
    await runCli(["list", "--path", "/a.md"], opts);
    await runCli(["get", "/nope.md"], opts); // errors are not logged

    const json = await runCli(["log", "--json"], { cwd: dir });
    expect(json.code).toBe(0);
    const entries = JSON.parse(json.stdout);
    expect(entries.map((e: { op: string; query: string | null; results: number }) => [e.op, e.query, e.results])).toEqual([
      ["search", "backup", 0],
      ["search", "backup", 1],
      ["get", "/a.md#backup", 1],
      ["list", null, 1],
    ]);
    expect(entries[0]).toMatchObject({ source: "cli", who: "cli", filters: { tag: "x" }, top: [] });
    expect(entries[1]).toMatchObject({ filters: {}, top: ["/a.md"], ms: expect.any(Number) });
    expect(entries[3].filters).toEqual({ paths: ["/a.md"] });
    // No disk paths in the log.
    const raw = readdirSync(path.join(dir, ".marian-knows", "logs")).map((f) =>
      readFileSync(path.join(dir, ".marian-knows", "logs", f), "utf8"),
    );
    expect(raw.join("")).not.toContain(dir);

    const zero = await runCli(["log", "--zero"], { cwd: dir });
    expect(zero.code).toBe(0);
    expect(zero.stdout).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}  cli  search  0  "backup"  \{"tag":"x"\}\n$/);
  });

  it("MARIAN_KNOWS_NO_LOG=1 leaves no log; empty log: exit 1 ([] with --json)", async () => {
    const dir = await project();
    await runCli(["search", "backup"], { cwd: dir });
    expect(existsSync(path.join(dir, ".marian-knows", "logs"))).toBe(false);
    expect(await runCli(["log"], { cwd: dir })).toMatchObject({ code: 1, stdout: "", stderr: "" });
    expect(await runCli(["log", "--json", "--days", "30"], { cwd: dir })).toMatchObject({ code: 1, stdout: "[]\n" });
  });

  it("--days expects a positive integer", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\n" });
    const r = await runCli(["log", "--days", "0"], { cwd: dir });
    expect(r).toMatchObject({ code: 2, stdout: "" });
    expect(r.stderr).toBe("error: --days expects a positive integer, got '0'\n");
  });

  it("destroy removes the logs with the index", async () => {
    const dir = await project();
    await runCli(["search", "backup"], { cwd: dir, log: true });
    expect(existsSync(path.join(dir, ".marian-knows", "logs"))).toBe(true);
    expect((await runCli(["destroy"], { cwd: dir })).code).toBe(0);
    expect(existsSync(path.join(dir, ".marian-knows"))).toBe(false);
  });
});

describe.concurrent("status", () => {
  it("shows config and a missing index, exit 0", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: Baza\n" });
    const r = await runCli(["status"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      `Project: Baza\nConfig: ${path.join(dir, "marian-knows.yml")}\nSource: ${dir}\nExclude: -\n` +
        "Index: none (run: marian-knows index)\n",
    );
  });

  it("shows counts, size and index age; --json has every field", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: Baza\nexclude: draft/**\n", "a.md": "# A", "b.md": "b" });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    const text = await runCli(["status"], { cwd: dir });
    expect(text.stdout).toMatch(/\nIndex: 2 files, 1 sections, [\d.]+ (B|KB|MB)\nIndexed at: \S+ \(\d+ s ago\)\n$/);
    const json = JSON.parse((await runCli(["status", "--json"], { cwd: dir })).stdout);
    expect(json).toEqual({
      name: "Baza",
      config: path.join(dir, "marian-knows.yml"),
      path: dir,
      pathExists: true,
      exclude: ["draft/**"],
      index: "ok",
      files: 2,
      sections: 1, // "# A" is a title only
      dbSize: expect.any(Number),
      indexedAt: expect.any(String),
      ageSeconds: expect.any(Number),
    });
  });

  it("--json with a missing index: nulls", async () => {
    const r = await runCli(["status", "--json"], { cwd: makeTree({ "marian-knows.yml": "name: P\n" }) });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ index: "missing", files: null, sections: null, dbSize: null, indexedAt: null });
  });

  it("without a config: exit 2", async () => {
    const r = await runCli(["status"], { cwd: makeTree() });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^error: config not found/);
  });
});

describe.concurrent("destroy", () => {
  it("removes .marian-knows/ only; a second run has nothing to remove", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\n", "a.md": "# A" });
    expect((await runCli(["index"], { cwd: dir })).code).toBe(0);
    const r = await runCli(["destroy"], { cwd: dir });
    expect(r).toMatchObject({ code: 0, stdout: "Removed the index (.marian-knows/)\n", stderr: "" });
    expect(snapshot(dir)).toEqual({ "marian-knows.yml": "name: P\n", "a.md": "# A" });
    expect(await runCli(["destroy"], { cwd: dir })).toMatchObject({ code: 0, stdout: "No index to remove\n" });
  });

  it("refuses while index is running: exit 2, nothing removed", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\n", ".marian-knows/index.lock": String(process.pid) });
    const r = await runCli(["destroy"], { cwd: dir });
    expect(r).toMatchObject({ code: 2, stderr: `error: index is already running (pid ${process.pid})\n` });
    expect(snapshot(dir)).toEqual({ "marian-knows.yml": "name: P\n", [path.join(".marian-knows", "index.lock")]: String(process.pid) });
  });
});

describe.concurrent("exit codes", () => {
  it.each([
    [["status", "extra"], "error: unexpected argument 'extra' for status"],
    [["init", "Baza", "wiedzy"], "error: unexpected argument 'wiedzy' for init"],
    [["list", "--bogus"], "error: Unknown option '--bogus'"],
    [["search", "x", "--path"], "error: Option '--path <value>' argument missing"],
  ].map(([args, stderr]) => ({ args: args as string[], stderr: stderr as string })))(
    "$args exits 2",
    async ({ args, stderr }) => {
      const dir = makeTree({ "marian-knows.yml": "name: P\n" });
      const r = await runCli(args, { cwd: dir });
      expect(r.code).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain(stderr);
    },
  );

  it("a broken index database is exit 2, not a crash with exit 1", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: P\n", ".marian-knows/index.db": "not a database" });
    for (const args of [["search", "a"], ["list"], ["get", "/a.md"]]) {
      expect((await runCli(args, { cwd: dir })).code).toBe(2);
    }
    const status = await runCli(["status", "--json"], { cwd: dir });
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout).index).toBe("outdated");
  });
});
