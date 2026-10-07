import { readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TokenError,
  TokenVerifier,
  addToken,
  hashToken,
  listTokens,
  loadConfig,
  readTokens,
  revokeToken,
  tokensPath,
} from "../src/core/index.js";
import { makeTree } from "./helpers.js";

const tokensFile = () => path.join(makeTree(), "kb.tokens.json");
const raw = (file: string) => JSON.parse(readFileSync(file, "utf8")) as { version: number; tokens: unknown[] };

describe("tokensPath", () => {
  it("is <config name>.tokens.json next to the config; MARIAN_KNOWS_TOKENS overrides it", () => {
    const dir = makeTree({ "team.yml": "name: Team\n" });
    const config = loadConfig(path.join(dir, "team.yml"));
    expect(tokensPath(config, {})).toBe(path.join(dir, "team.tokens.json"));
    expect(tokensPath(config, { MARIAN_KNOWS_TOKENS: "secrets/t.json" })).toBe(path.join(dir, "secrets/t.json"));
    expect(tokensPath(config, { MARIAN_KNOWS_TOKENS: "/etc/t.json" })).toBe("/etc/t.json");
  });
});

describe("token file", () => {
  it("add returns mk_ + 32 random bytes and stores only the SHA-256, name and dates", () => {
    const file = tokensFile();
    const token = addToken(file, "  anna ", new Date("2026-10-01T10:00:00Z"));
    expect(token).toMatch(/^mk_[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(file, "utf8")).not.toContain(token);
    expect(raw(file)).toEqual({
      version: 1,
      tokens: [{ name: "anna", hash: hashToken(token), createdAt: "2026-10-01T10:00:00.000Z", lastUsedAt: null }],
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(addToken(file, "bob")).not.toBe(token);
  });

  it("rejects a duplicate or invalid name", () => {
    const file = tokensFile();
    addToken(file, "anna");
    expect(() => addToken(file, "anna ")).toThrow(new TokenError("a token named 'anna' already exists"));
    expect(() => addToken(file, "  ")).toThrow(/invalid token name: must not be empty/);
    expect(listTokens(file)).toHaveLength(1);
  });

  it("list shows names and dates, never hashes; a missing file is an empty list", () => {
    const file = tokensFile();
    expect(listTokens(file)).toEqual([]);
    addToken(file, "anna", new Date("2026-10-01T10:00:00Z"));
    expect(listTokens(file)).toEqual([{ name: "anna", createdAt: "2026-10-01T10:00:00.000Z", lastUsedAt: null }]);
  });

  it("revoke removes the token; an unknown name is an error", () => {
    const file = tokensFile();
    addToken(file, "anna");
    addToken(file, "bob");
    revokeToken(file, "anna");
    expect(listTokens(file).map((t) => t.name)).toEqual(["bob"]);
    expect(() => revokeToken(file, "anna")).toThrow(new TokenError("no token named 'anna'"));
  });

  it("refuses another file version and a broken file", () => {
    const file = tokensFile();
    writeFileSync(file, JSON.stringify({ version: 2, tokens: [] }));
    expect(() => readTokens(file)).toThrow(/has version 2; this marian-knows reads version 1/);
    expect(() => addToken(file, "anna")).toThrow(TokenError);
    writeFileSync(file, "{");
    expect(() => readTokens(file)).toThrow(/not valid JSON/);
    writeFileSync(file, JSON.stringify({ version: 1, tokens: [{ name: "x" }] }));
    expect(() => listTokens(file)).toThrow(/invalid tokens file .*tokens > 0 > hash/);
  });

  it("breaks a stale lock left by a killed process", () => {
    const file = tokensFile();
    writeFileSync(`${file}.lock`, "999999");
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${file}.lock`, old, old);
    expect(() => addToken(file, "anna")).not.toThrow();
    expect(listTokens(file).map((t) => t.name)).toEqual(["anna"]);
  });
});

describe("TokenVerifier", () => {
  it("accepts known tokens, rejects others, and sees add and revoke from another process", () => {
    const file = tokensFile();
    const anna = addToken(file, "anna");
    const verifier = new TokenVerifier(file);
    expect(verifier.verify(anna)).toBe("anna");
    expect(verifier.verify("mk_nope")).toBeNull();
    expect(verifier.verify(anna.slice(0, -1))).toBeNull();

    const bob = addToken(file, "bob");
    expect(verifier.verify(bob)).toBe("bob");
    revokeToken(file, "anna");
    expect(verifier.verify(anna)).toBeNull();
    expect(verifier.size).toBe(1);
  });

  it("fails closed on a broken file, with one warning", () => {
    const file = tokensFile();
    const anna = addToken(file, "anna");
    const warnings: string[] = [];
    const verifier = new TokenVerifier(file, (w) => warnings.push(w));
    writeFileSync(file, JSON.stringify({ version: 2, tokens: [] }));
    expect(verifier.verify(anna)).toBeNull();
    expect(verifier.verify(anna)).toBeNull();
    expect(warnings).toEqual([expect.stringMatching(/version 2.*every request is rejected/)]);
  });

  it("keeps last use in memory and writes it on flush, for the same token only", () => {
    const file = tokensFile();
    const anna = addToken(file, "anna");
    const verifier = new TokenVerifier(file);
    verifier.verify(anna, new Date("2026-10-02T08:00:00Z"));
    verifier.flush();
    expect(listTokens(file)[0]!.lastUsedAt).toBe("2026-10-02T08:00:00.000Z");

    // Within the minute: not written until the next flush.
    verifier.verify(anna, new Date("2026-10-02T08:00:30Z"));
    expect(listTokens(file)[0]!.lastUsedAt).toBe("2026-10-02T08:00:00.000Z");

    // Revoked and re-added under the same name before the flush: the new token keeps its own (empty) last use.
    revokeToken(file, "anna");
    addToken(file, "anna");
    verifier.flush();
    expect(listTokens(file)[0]!.lastUsedAt).toBeNull();
  });
});
