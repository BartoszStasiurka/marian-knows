import { describe, expect, it } from "vitest";
import { validateVirtualPath } from "../src/core/index.js";

describe("validateVirtualPath", () => {
  it.each(["/", "/server/", "/README.md", "/Notes/ąę/plik.md", "/a b/c.md"])("accepts %s", (p) => {
    expect(validateVirtualPath(p)).toEqual([]);
  });

  it.each([
    ["", "must start with '/'"],
    ["server/", "must start with '/'"],
    ["/a//b/", "empty segments"],
    ["/a/./b/", "forbidden segment '.'"],
    ["/a/../b/", "forbidden segment '..'"],
    ["/a\\b/", "'\\'"],
    ["/a\tb/", "control characters"],
    ["/ a/", "whitespace"],
    ["/a /", "whitespace"],
    ["/" + "x".repeat(600), "longer than 512"],
    ["/e\u0301/", "NFC"],
  ])("rejects %j", (p, fragment) => {
    const errors = validateVirtualPath(p);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("|")).toContain(fragment);
  });
});
