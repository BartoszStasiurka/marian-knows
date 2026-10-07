import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  addToken,
  isSessionEntry,
  listTokens,
  loadConfig,
  logDir,
  readQueryLog,
  rebuildIndex,
  revokeToken,
  tokensPath,
  type LoadedConfig,
} from "../src/core/index.js";
import { startHttpServer, type HttpServerHandle } from "../src/mcp.js";
import { CLI, TSX, makeTree } from "./helpers.js";

const FILES = {
  "marian-knows.yml": "name: Test KB\n",
  "hr/urlopy.md": "---\ntags: [hr]\n---\n# Urlopy\n\nKażdy pracownik ma 26 dni urlopu wypoczynkowego w roku.\n",
};

const handles: HttpServerHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
});

async function start(opts: { idleMs?: number } = {}) {
  const dir = makeTree(FILES);
  const config = loadConfig(path.join(dir, "marian-knows.yml"));
  await rebuildIndex(config);
  const file = tokensPath(config, {});
  const anna = addToken(file, "anna");
  const handle = await startHttpServer(config, { port: 0, host: "127.0.0.1", tokensFile: file, ...opts });
  handles.push(handle);
  return { dir, config, file, anna, handle, url: handle.url };
}

async function connect(url: string, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "http-test", version: "1" });
  await client.connect(transport);
  return { client, transport };
}

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };
const search = async (client: Client, query: string) =>
  (await client.callTool({ name: "search", arguments: { query } })) as ToolResult;

function accessLog(config: LoadedConfig): Record<string, unknown>[] {
  const day = new Date().toISOString().slice(0, 10);
  try {
    return readFileSync(path.join(logDir(config), `access-${day}.jsonl`), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

const sessions = (config: LoadedConfig) => readQueryLog(config).entries.filter(isSessionEntry);

const until = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("MCP over HTTP", () => {
  it("serves the tools to a valid token and logs it as who", async () => {
    const { url, anna, config } = await start();
    const { client } = await connect(url, anna);
    const r = await search(client, "urlopu");
    expect((JSON.parse(r.content[0]!.text) as { path: string }[]).map((h) => h.path)).toEqual(["/hr/urlopy.md"]);
    const entries = readQueryLog(config).entries;
    expect(entries.map((e) => [e.who, e.op])).toEqual([
      ["anna", "connect"],
      ["anna", "search"],
    ]);
    expect(entries[0]).toMatchObject({ source: "mcp", client: { name: "http-test", version: "1" } });
  });

  it("rejects a missing, malformed or unknown token with 401 and an access log line", async () => {
    const { url, config } = await start();
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    const post = (headers: Record<string, string>) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "probe", ...headers },
        body: JSON.stringify(init),
      });
    const missing = await post({});
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe('Bearer realm="marian-knows"');
    expect((await post({ Authorization: "Basic abc" })).status).toBe(401);
    expect((await post({ Authorization: "Bearer mk_wrong", "X-Forwarded-For": "203.0.113.7" })).status).toBe(401);

    const log = accessLog(config);
    expect(log.map((e) => e.reason)).toEqual(["missing", "malformed", "unknown"]);
    expect(log[2]).toEqual({
      ts: expect.any(String),
      status: 401,
      reason: "unknown",
      ip: expect.stringMatching(/127\.0\.0\.1/),
      forwardedFor: "203.0.113.7",
      method: "POST",
      path: "/mcp",
      userAgent: "probe",
    });
    expect(JSON.stringify(log)).not.toContain("mk_wrong");
    expect(readQueryLog(config).entries).toEqual([]);
  });

  it("answers 404 outside /mcp without asking for a token", async () => {
    const { url, config } = await start();
    expect((await fetch(new URL("/other", url))).status).toBe(404);
    expect(accessLog(config)).toEqual([]);
  });

  it("a revoked token is rejected from the next request on, also inside an open session", async () => {
    const { url, anna, file, config } = await start();
    const { client } = await connect(url, anna);
    expect((await search(client, "urlopu")).isError).toBeFalsy();
    revokeToken(file, "anna");
    await expect(search(client, "urlopu")).rejects.toThrow(/unauthorized/);
    expect(accessLog(config).map((e) => e.reason)).toEqual(["unknown"]);
  });

  it("a token added while the server runs works without a restart", async () => {
    const { url, file } = await start();
    const bob = addToken(file, "bob");
    const { client } = await connect(url, bob);
    expect((await search(client, "urlopu")).isError).toBeFalsy();
  });

  it("a session belongs to the token that opened it", async () => {
    const { url, anna, file } = await start();
    const bob = addToken(file, "bob");
    const { transport } = await connect(url, anna);
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bob}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": transport.sessionId!,
        "Mcp-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(r.status).toBe(404);
  });

  it("a session ends with disconnect on DELETE", async () => {
    const { url, anna, config, handle } = await start();
    const { client, transport } = await connect(url, anna);
    await search(client, "urlopu");
    await search(client, "zzzz");
    expect(handle.sessions()).toBe(1);
    await transport.terminateSession();
    expect(handle.sessions()).toBe(0);
    expect(sessions(config).map((e) => e.op)).toEqual(["connect", "disconnect"]);
    expect(sessions(config)[1]).toMatchObject({ who: "anna", calls: 2, ms: expect.any(Number) });
  });

  it("an idle session times out with disconnect", async () => {
    // Long enough for the client to finish the handshake under a loaded test run.
    const { url, anna, config, handle } = await start({ idleMs: 1000 });
    await connect(url, anna);
    expect(handle.sessions()).toBe(1);
    await until(() => handle.sessions() === 0, 5000);
    expect(sessions(config).map((e) => e.op)).toEqual(["connect", "disconnect"]);
  });

  it("close ends open sessions and writes the token's last use", async () => {
    const { url, anna, config, file, handle } = await start();
    await connect(url, anna);
    await handle.close();
    expect(sessions(config).map((e) => e.op)).toEqual(["connect", "disconnect"]);
    expect(listTokens(file)[0]!.lastUsedAt).toEqual(expect.any(String));
  });
});

describe("marian-knows serve --http", () => {
  it("prints the endpoint on stderr, serves with a token, and closes sessions on SIGTERM", async () => {
    const { dir, config, file, anna } = await (async () => {
      const dir = makeTree(FILES);
      const config = loadConfig(path.join(dir, "marian-knows.yml"));
      await rebuildIndex(config);
      const file = tokensPath(config, {});
      return { dir, config, file, anna: addToken(file, "anna") };
    })();
    const env = { ...process.env };
    delete env.MARIAN_KNOWS_CONFIG;
    delete env.MARIAN_KNOWS_NO_LOG;
    delete env.MARIAN_KNOWS_TOKENS;
    const child = spawn(process.execPath, ["--import", TSX, CLI, "serve", "--http", "--port", "0"], { cwd: dir, env });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
    try {
      await until(() => /MCP over HTTP: (\S+)/.test(stderr), 10_000);
      const url = /MCP over HTTP: (\S+)/.exec(stderr)![1]!;
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      const { client } = await connect(url, anna);
      expect((await search(client, "urlopu")).isError).toBeFalsy();
    } finally {
      child.kill("SIGTERM");
    }
    expect(await exited).toBe(0);
    expect(sessions(config).map((e) => e.op)).toEqual(["connect", "disconnect"]);
    expect(listTokens(file)[0]!.lastUsedAt).toEqual(expect.any(String));
  });
});
