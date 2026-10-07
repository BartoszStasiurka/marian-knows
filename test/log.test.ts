import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_LOG_ENV, loadConfig, logDir, logDisabled, logQuery, readQueryLog } from "../src/core/index.js";
import { makeTree } from "./helpers.js";

const NOW = new Date("2026-10-07T10:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function project() {
  const dir = makeTree({ "marian-knows.yml": "name: T\n" });
  return { dir, config: loadConfig(path.join(dir, "marian-knows.yml")) };
}

const record = (over: Partial<Parameters<typeof logQuery>[1]> = {}): Parameters<typeof logQuery>[1] => ({
  source: "cli",
  who: "cli",
  op: "search",
  query: "backup",
  paths: [],
  ms: 1.4,
  ...over,
});

describe("query log", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[NO_LOG_ENV];
    delete process.env[NO_LOG_ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[NO_LOG_ENV];
    else process.env[NO_LOG_ENV] = saved;
  });

  it("appends one JSON line per query to the file of the UTC day", () => {
    const { config } = project();
    const paths = ["/a.md", "/b.md", "/c.md", "/d.md", "/e.md", "/f.md"];
    const filters = { tag: "ops", paths: ["/a/"], excludePaths: [], limit: undefined, exact: false };
    expect(logQuery(config, record({ paths, filters }), NOW)).toEqual([]);
    expect(logQuery(config, record({ op: "list", query: null }), NOW)).toEqual([]);

    const file = path.join(logDir(config), "queries-2026-10-07.jsonl");
    const lines = readFileSync(file, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([
      {
        ts: "2026-10-07T10:00:00.000Z",
        source: "cli",
        who: "cli",
        op: "search",
        query: "backup",
        filters: { tag: "ops", paths: ["/a/"], exact: false },
        results: 6,
        top: ["/a.md", "/b.md", "/c.md", "/d.md", "/e.md"],
        ms: 1,
      },
      expect.objectContaining({ op: "list", query: null, filters: {}, results: 0, top: [] }),
    ]);
  });

  it("is off with MARIAN_KNOWS_NO_LOG set to anything but empty or 0", () => {
    const { config } = project();
    for (const v of ["1", "true"]) expect(logDisabled({ [NO_LOG_ENV]: v })).toBe(true);
    for (const v of [undefined, "", "0"]) expect(logDisabled({ [NO_LOG_ENV]: v })).toBe(false);
    process.env[NO_LOG_ENV] = "1";
    logQuery(config, record(), NOW);
    expect(existsSync(logDir(config))).toBe(false);
  });

  it("deletes dated log files past 90 days on write", () => {
    const { config } = project();
    const dir = logDir(config);
    mkdirSync(dir, { recursive: true });
    for (const name of ["queries-2026-07-08.jsonl", "queries-2026-07-09.jsonl", "access-2026-01-01.jsonl", "notes.txt"]) {
      writeFileSync(path.join(dir, name), "");
    }
    logQuery(config, record(), NOW);
    expect(readdirSync(dir).sort()).toEqual(["notes.txt", "queries-2026-07-09.jsonl", "queries-2026-10-07.jsonl"]);
  });

  it("a failed write is a warning, never an exception", () => {
    const { config } = project();
    mkdirSync(path.dirname(logDir(config)), { recursive: true });
    writeFileSync(logDir(config), "a file where the directory should be");
    expect(logQuery(config, record(), NOW)).toEqual([expect.stringMatching(/^cannot write the query log \(\w+\)$/)]);
  });

  it.skipIf(process.getuid?.() === 0)("an unwritable log directory is a warning", () => {
    const { config } = project();
    mkdirSync(logDir(config), { recursive: true });
    chmodSync(logDir(config), 0o500);
    try {
      expect(logQuery(config, record(), NOW)).toEqual(["cannot write the query log (EACCES)"]);
    } finally {
      chmodSync(logDir(config), 0o700);
    }
  });

  it("reads the last N days, oldest first; --zero keeps queries with no results", () => {
    const { config } = project();
    logQuery(config, record({ query: "old" }), ago(8));
    logQuery(config, record({ query: "edge", paths: ["/a.md"] }), ago(6.9));
    logQuery(config, record({ query: "today" }), NOW);
    logQuery(config, record({ query: "hit", paths: ["/a.md"] }), ago(1));

    const queries = (o: Parameters<typeof readQueryLog>[1]) => readQueryLog(config, o, NOW).entries.map((e) => e.query);
    expect(queries({})).toEqual(["edge", "hit", "today"]);
    expect(queries({ days: 30 })).toEqual(["old", "edge", "hit", "today"]);
    expect(queries({ days: 1 })).toEqual(["hit", "today"]);
    expect(queries({ zero: true, days: 30 })).toEqual(["old", "today"]);
  });

  it("no log directory = empty log; broken lines are skipped with a warning", () => {
    const { config } = project();
    expect(readQueryLog(config, {}, NOW)).toEqual({ entries: [], warnings: [] });
    logQuery(config, record(), NOW);
    const file = path.join(logDir(config), "queries-2026-10-07.jsonl");
    writeFileSync(file, readFileSync(file, "utf8") + "{broken\n[]\n");
    const r = readQueryLog(config, {}, NOW);
    expect(r.entries).toHaveLength(1);
    expect(r.warnings).toEqual(["skipped 2 broken log line(s)"]);
  });
});
