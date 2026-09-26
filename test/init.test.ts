import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, initConfig, loadConfig } from "../src/core/index.js";
import { makeTree } from "./helpers.js";

function errorsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e.errors;
    throw e;
  }
  throw new Error("expected ConfigError");
}

describe("initConfig", () => {
  it("creates a minimal config that loadConfig accepts", () => {
    const dir = makeTree();
    const target = path.join(dir, "marian-knows.yml");
    expect(initConfig(target, "Baza wiedzy klienta")).toBe(target);
    expect(readFileSync(target, "utf8")).toBe("name: Baza wiedzy klienta\n");
    expect(loadConfig(target)).toMatchObject({ name: "Baza wiedzy klienta", sourceDir: dir, exclude: [] });
  });

  it("trims the name and quotes YAML-significant values", () => {
    const dir = makeTree();
    const target = path.join(dir, "marian-knows.yml");
    initConfig(target, "  yes: #1  ");
    expect(loadConfig(target).name).toBe("yes: #1");
  });

  it("never overwrites an existing file", () => {
    const dir = makeTree();
    const target = path.join(dir, "marian-knows.yml");
    writeFileSync(target, "keep me\n");
    expect(errorsOf(() => initConfig(target, "X"))[0]).toMatch(/already exists/);
    expect(readFileSync(target, "utf8")).toBe("keep me\n");
  });

  it("rejects an invalid name without creating a file", () => {
    const dir = makeTree();
    const target = path.join(dir, "marian-knows.yml");
    expect(errorsOf(() => initConfig(target, "   "))[0]).toMatch(/^name: must not be empty/);
    expect(errorsOf(() => initConfig(target, "x".repeat(129)))[0]).toMatch(/longer than 128/);
    expect(existsSync(target)).toBe(false);
  });

  it("reports a missing parent directory", () => {
    const dir = makeTree();
    expect(errorsOf(() => initConfig(path.join(dir, "no", "such", "c.yml"), "X"))[0]).toMatch(/cannot create/);
  });

  it("does not touch .gitignore or create database files", () => {
    const dir = makeTree({ ".gitignore": "node_modules/\n" });
    initConfig(path.join(dir, "marian-knows.yml"), "X");
    expect(readdirSync(dir).sort()).toEqual([".gitignore", "marian-knows.yml"]);
    expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("node_modules/\n");
  });
});
