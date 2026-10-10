import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GitError,
  IndexLockedError,
  acquireIndexLock,
  list,
  loadConfig,
  refreshIndex,
  startIndexRefresh,
  syncIndex,
} from "../src/core/index.js";
import { makeOrigin, makeTree } from "./helpers.js";

function gitProject(url: string, gitPath = "docs") {
  const dir = makeTree();
  const file = path.join(dir, "marian-knows.yml");
  writeFileSync(file, `name: T\npath: ./kb\ngit:\n  url: ${JSON.stringify(url)}\n  path: ${gitPath}\n`);
  return { dir, file, config: loadConfig(file) };
}

describe("refreshIndex", () => {
  it("without git only syncs the index", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: T\n", "a.md": "# A" });
    const r = await refreshIndex(loadConfig(path.join(dir, "marian-knows.yml")));
    expect(r.git).toBeNull();
    expect(r.index).toMatchObject({ files: 1, added: 1 });
    expect(r.warnings).toEqual([]);
  });

  it("clones, then indexes the directory that just appeared", async () => {
    const origin = makeOrigin({ "docs/a.md": "# Alpha", "README.md": "# Root" });
    const { config } = gitProject(origin.url);
    expect(config.sourceExists).toBe(false);
    const lines: string[] = [];
    const r = await refreshIndex(config, { log: (l) => lines.push(l) });
    expect(r.git?.action).toBe("cloned");
    expect(r.index).toMatchObject({ files: 1, added: 1 });
    expect(lines[0]).toBe(`git: cloning ${origin.url} (main)`);
    expect(list(config).docs.map((d) => d.path)).toEqual(["/a.md"]);
  });

  it("picks up a new commit on the next run", async () => {
    const origin = makeOrigin({ "docs/a.md": "# Alpha" });
    const { config } = gitProject(origin.url);
    await refreshIndex(config);
    origin.commit({ "docs/b.md": "# Beta" });
    const r = await refreshIndex(config);
    expect(r.git?.action).toBe("updated");
    expect(r.index).toMatchObject({ files: 2, added: 1 });
  });

  it("leaves the index alone when the indexed directory is missing after the git step", async () => {
    const origin = makeOrigin({ "docs/a.md": "# Alpha" });
    const { file, config } = gitProject(origin.url);
    await refreshIndex(config);
    writeFileSync(file, `name: T\npath: ./kb\ngit:\n  url: ${JSON.stringify(origin.url)}\n  path: doc\n`);
    const r = await refreshIndex(loadConfig(file));
    expect(r.index).toBeNull();
    expect(r.warnings).toContain("git.path not found in the repository: doc");
    expect(r.warnings.at(-1)).toMatch(/^not indexing: .*kb\/doc does not exist; the previous index stays$/);
    expect(list(config).docs.map((d) => d.path)).toEqual(["/a.md"]);
  });

  it("holds the index lock over the git step too", async () => {
    const origin = makeOrigin({ "docs/a.md": "# Alpha" });
    const { dir, config } = gitProject(origin.url);
    const release = acquireIndexLock(config);
    try {
      await expect(refreshIndex(config)).rejects.toBeInstanceOf(IndexLockedError);
      expect(existsSync(path.join(dir, "kb"))).toBe(false);
    } finally {
      release();
    }
  });

  it("releases the lock after a git error", async () => {
    const { config } = gitProject(`file://${makeTree()}/missing.git`);
    await expect(refreshIndex(config)).rejects.toBeInstanceOf(GitError);
    await expect(syncIndex(config)).resolves.toMatchObject({ files: 0 });
  });
});

describe("startIndexRefresh", () => {
  const until = async (check: () => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  function plainProject(files: Record<string, string>) {
    const dir = makeTree({ "marian-knows.yml": "name: T\n", ...files });
    return { dir, config: loadConfig(path.join(dir, "marian-knows.yml")) };
  }

  it("refreshes at start, then every interval, printing only runs that changed something", async () => {
    const { dir, config } = plainProject({ "a.md": "# A" });
    const lines: string[] = [];
    let runs = 0;
    const refresher = startIndexRefresh(config, {
      everyMs: 30,
      log: (l) => lines.push(l),
      warn: (w) => lines.push(`warning: ${w}`),
      onRun: () => runs++,
    });
    try {
      await until(() => runs >= 3);
      expect(lines).toEqual([expect.stringMatching(/^index: 1 files, \+ 1 added, ~ 0 changed, - 0 removed \(\d+\.\d s\)$/)]);
      writeFileSync(path.join(dir, "b.md"), "# B");
      await until(() => lines.length === 2);
      expect(lines[1]).toMatch(/^index: 2 files, \+ 1 added/);
      expect(list(config).docs.map((d) => d.path)).toEqual(["/a.md", "/b.md"]);
    } finally {
      await refresher.stop();
    }
  });

  it("with everyMs 0 refreshes only at start", async () => {
    const { config } = plainProject({ "a.md": "# A" });
    let runs = 0;
    const refresher = startIndexRefresh(config, { everyMs: 0, log: () => {}, warn: () => {}, onRun: () => runs++ });
    await until(() => runs === 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(runs).toBe(1);
    await refresher.stop();
  });

  it("a locked index or a git error is a warning, and the next run tries again", async () => {
    const { config } = plainProject({ "a.md": "# A" });
    const release = acquireIndexLock(config);
    const warnings: string[] = [];
    let runs = 0;
    const refresher = startIndexRefresh(config, {
      everyMs: 30,
      log: () => {},
      warn: (w) => warnings.push(w),
      onRun: () => runs++,
    });
    try {
      await until(() => runs >= 1);
      expect(warnings[0]).toBe(`index refresh skipped: index is already running (pid ${process.pid})`);
      release();
      await until(() => runs >= 2);
      expect(list(config).docs.map((d) => d.path)).toEqual(["/a.md"]);
    } finally {
      await refresher.stop();
    }

    const failing = gitProject(`file://${makeTree()}/missing.git`);
    const gitWarnings: string[] = [];
    const again = startIndexRefresh(failing.config, { everyMs: 0, log: () => {}, warn: (w) => gitWarnings.push(w) });
    await until(() => gitWarnings.length > 0, 10_000);
    expect(gitWarnings[0]).toMatch(/^index refresh failed: cannot clone /);
    await again.stop();
  });

  it("stop waits for a running refresh and stops the schedule", async () => {
    const origin = makeOrigin({ "docs/a.md": "# Alpha" });
    const { config } = gitProject(origin.url);
    let runs = 0;
    const refresher = startIndexRefresh(config, { everyMs: 10, log: () => {}, warn: () => {}, onRun: () => runs++ });
    await refresher.stop();
    expect(runs).toBe(1);
    expect(list(config).docs.map((d) => d.path)).toEqual(["/a.md"]);
    await new Promise((r) => setTimeout(r, 60));
    expect(runs).toBe(1);
  });
});
