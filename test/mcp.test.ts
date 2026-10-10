import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { isSessionEntry, loadConfig, readQueryLog, rebuildIndex, type SessionLogEntry } from "../src/core/index.js";
import { createMcpServer } from "../src/mcp.js";
import { CLI, TSX, makeTree } from "./helpers.js";

const FILES = {
  "ops/backup.md": [
    "---",
    "tags: [ops]",
    "---",
    "# Backup",
    "",
    "Intro to how backups work in the company, written long enough to stay a section of its own here.",
    "",
    "## Harmonogram",
    "",
    "Codzienny backup bazy danych o 03:00, kopie trzymamy przez 30 dni w osobnym regionie chmury.",
    "Weekly restore test runs every Monday so we know the copies can actually be restored.",
    "The on-call engineer checks the report and opens a ticket when a restore fails or runs too long.",
    "",
  ].join("\n"),
  "hr/urlopy.md": "---\ntags: [hr]\n---\n# Urlopy\n\nKażdy pracownik ma 26 dni urlopu wypoczynkowego w roku.\n",
};

async function connect(files: Record<string, string> = FILES, opts: { index?: boolean; yaml?: string } = {}) {
  const dir = makeTree({ ...files, "marian-knows.yml": opts.yaml ?? "name: Test KB\n" });
  const config = loadConfig(path.join(dir, "marian-knows.yml"));
  if (opts.index !== false) await rebuildIndex(config);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(config, { who: "local" }).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return { dir, config, client };
}

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

const parsed = (r: ToolResult) => JSON.parse(r.content[0]!.text) as unknown;

describe("MCP server", () => {
  it("lists the four read-only tools with model-facing descriptions", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get", "list", "search", "status"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    const search = tools.find((t) => t.name === "search")!;
    expect(search.description).toMatch(/2-4 keywords/);
    expect(search.description).toMatch(/synonyms/);
    expect(search.description).toMatch(/#<anchor>/);
    expect(Object.keys(search.inputSchema.properties ?? {}).sort()).toEqual(
      ["exact", "excludePath", "limit", "path", "query", "tag"].sort(),
    );
    expect(client.getInstructions()).toMatch(/2-4 keywords/);
  });

  it("search returns the --json contract with heading and snippet", async () => {
    const { client } = await connect();
    const r = await call(client, "search", { query: "backup bazy" });
    expect(r.isError).toBeFalsy();
    expect(parsed(r)).toEqual([
      {
        path: "/ops/backup.md",
        title: "Backup",
        tags: ["ops"],
        score: expect.any(Number),
        anchor: "harmonogram",
        heading: "Harmonogram",
        snippet: expect.stringContaining("[backup]"),
      },
    ]);
  });

  it("search applies scope, tag and limit; no results is [] and not an error", async () => {
    const { client } = await connect();
    expect(parsed(await call(client, "search", { query: "backup", path: ["/hr/"] }))).toEqual([]);
    expect(parsed(await call(client, "search", { query: "urlopu", tag: "HR" }))).toHaveLength(1);
    const none = await call(client, "search", { query: "zzzz" });
    expect(none.isError).toBeFalsy();
    expect(parsed(none)).toEqual([]);
  });

  it("search reports a scope with no files as a warning block", async () => {
    const { client } = await connect();
    const r = await call(client, "search", { query: "backup", path: ["/nope/"] });
    expect(parsed(r)).toEqual([]);
    expect(r.content[1]!.text).toBe("warning: no indexed files under /nope/");
  });

  it("rejects a limit over the cap and an empty query", async () => {
    const { client } = await connect();
    expect((await call(client, "search", { query: "backup", limit: 51 })).isError).toBe(true);
    expect((await call(client, "search", { query: "" })).isError).toBe(true);
  });

  it("get returns a whole file or one section as Markdown", async () => {
    const { client } = await connect();
    const file = await call(client, "get", { path: "/hr/urlopy.md" });
    expect(file.content[0]!.text).toBe(FILES["hr/urlopy.md"]);
    const section = await call(client, "get", { path: "/ops/backup.md#harmonogram" });
    expect(section.content[0]!.text).toMatch(/^## Harmonogram\n\nCodzienny backup/);
  });

  it("get errors are tool errors with the core message", async () => {
    const { client } = await connect();
    const anchor = await call(client, "get", { path: "/ops/backup.md#nope" });
    expect(anchor.isError).toBe(true);
    expect(anchor.content[0]!.text).toBe("error: no section #nope in /ops/backup.md; anchors: #harmonogram");
    const missing = await call(client, "get", { path: "/x.md" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toBe("error: not in the index: /x.md");
    expect((await call(client, "get", { path: "ops/backup.md" })).isError).toBe(true);
  });

  it("list returns {path, title, tags} sorted by path, with filters", async () => {
    const { client } = await connect();
    expect(parsed(await call(client, "list"))).toEqual([
      { path: "/hr/urlopy.md", title: "Urlopy", tags: ["hr"] },
      { path: "/ops/backup.md", title: "Backup", tags: ["ops"] },
    ]);
    expect(parsed(await call(client, "list", { excludePath: ["/hr/"] }))).toEqual([
      { path: "/ops/backup.md", title: "Backup", tags: ["ops"] },
    ]);
  });

  it("puts the config's name and description in the instructions and the search description", async () => {
    const yaml = "name: Test KB\ndescription: Company procedures in Polish. Check here first.\n";
    const { client } = await connect(FILES, { yaml });
    const about = 'Knowledge base "Test KB": Company procedures in Polish. Check here first.';
    expect(client.getInstructions()).toMatch(new RegExp(`^${about}\\n\\n`));
    expect(client.getInstructions()).toMatch(/search → get|path#anchor/);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "search")!.description).toMatch(new RegExp(`^${about}\\n`));
  });

  it("without a description, tells the agent to look with list", async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toMatch(/^Knowledge base "Test KB"\. No description is set: call list/);
  });

  it("status leaves out disk paths", async () => {
    const { client, dir } = await connect();
    const r = await call(client, "status");
    expect(r.content[0]!.text).not.toContain(dir);
    expect(parsed(r)).toEqual({
      name: "Test KB",
      description: null,
      pathExists: true,
      exclude: [],
      index: "ok",
      files: 2,
      sections: expect.any(Number),
      dbSize: expect.any(Number),
      indexedAt: expect.any(String),
      ageSeconds: expect.any(Number),
    });
  });

  it("a missing index is a tool error, status still answers", async () => {
    const { client } = await connect(FILES, { index: false });
    const r = await call(client, "search", { query: "backup" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("error: No index. Run: marian-knows index");
    expect(parsed(await call(client, "status"))).toMatchObject({ index: "missing", files: null });
  });

  it("logs search, get and list with source mcp and who local", async () => {
    const { client, config } = await connect();
    await call(client, "search", { query: "backup", limit: 3 });
    await call(client, "get", { path: "/ops/backup.md#harmonogram" });
    await call(client, "list", { tag: "hr" });
    await call(client, "get", { path: "/x.md" }); // failed calls are not logged
    await call(client, "status"); // status is not logged
    const entries = readQueryLog(config)
      .entries.filter((e) => !isSessionEntry(e))
      .map(({ ts: _ts, ms: _ms, ...e }) => e);
    expect(entries).toEqual([
      {
        source: "mcp",
        who: "local",
        op: "search",
        query: "backup",
        filters: { limit: 3 },
        results: 1,
        top: ["/ops/backup.md"],
      },
      {
        source: "mcp",
        who: "local",
        op: "get",
        query: "/ops/backup.md#harmonogram",
        filters: {},
        results: 1,
        top: ["/ops/backup.md"],
      },
      { source: "mcp", who: "local", op: "list", query: null, filters: { tag: "hr" }, results: 1, top: ["/hr/urlopy.md"] },
    ]);
  });

  it("logs session connect with the client info and disconnect with the call count", async () => {
    const { client, config } = await connect();
    const sessions = () => readQueryLog(config).entries.filter(isSessionEntry);
    const info = { name: "test", version: "0" };
    expect(sessions()).toEqual([{ ts: expect.any(String), source: "mcp", who: "local", op: "connect", client: info }]);
    await call(client, "search", { query: "backup" });
    await call(client, "get", { path: "/x.md" }); // failed calls count
    await call(client, "status"); // status counts
    await client.close();
    expect(sessions()[1]).toEqual({
      ts: expect.any(String),
      source: "mcp",
      who: "local",
      op: "disconnect",
      client: info,
      calls: 3,
      ms: expect.any(Number),
    });
    expect(sessions()).toHaveLength(2);
  });
});

describe("marian-knows serve", () => {
  it("builds a missing index at start, in the background", async () => {
    const dir = makeTree({ "marian-knows.yml": "name: T\n", "a.md": "# Alpha\n\nalpha text" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", TSX, CLI, "serve"],
      cwd: dir,
      env: { ...(process.env as Record<string, string>), MARIAN_KNOWS_CONFIG: "", MARIAN_KNOWS_NO_LOG: "1" },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      const end = Date.now() + 10_000;
      for (;;) {
        const r = await call(client, "status", {});
        if ((parsed(r) as { index: string }).index === "ok") break;
        if (Date.now() > end) throw new Error("index not built");
        await new Promise((r) => setTimeout(r, 50));
      }
      expect((parsed(await call(client, "list", {})) as { path: string }[]).map((d) => d.path)).toEqual(["/a.md"]);
      expect(stderr).toMatch(/index: 1 files, \+ 1 added/);
    } finally {
      await client.close();
    }
  });

  it("serves the knowledge base over stdio; closing stdin ends the session", async () => {
    const { dir, config } = await connect();
    const before = readQueryLog(config).entries.length;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "MARIAN_KNOWS_CONFIG" && k !== "MARIAN_KNOWS_NO_LOG") env[k] = v;
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", TSX, CLI, "serve"],
      cwd: dir,
      env,
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      const r = await call(client, "search", { query: "urlopu" });
      expect((parsed(r) as { path: string }[]).map((h) => h.path)).toEqual(["/hr/urlopy.md"]);
    } finally {
      await client.close();
    }
    const entries = readQueryLog(config).entries.slice(before);
    expect(entries.map((e) => e.op)).toEqual(["connect", "search", "disconnect"]);
    expect(entries[2]).toMatchObject({ client: { name: "test", version: "0" }, calls: 1 });
  });
});
