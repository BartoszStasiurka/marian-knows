import { describe, expect, it } from "vitest";
import { InvalidPathError, hasTag, inScope, matchesPath, validateScope } from "../src/core/index.js";

describe("matchesPath", () => {
  it("trailing '/' covers a subtree at any depth, not a sibling with the same prefix", () => {
    expect(matchesPath("/projekt/A/x.md", "/projekt/A/")).toBe(true);
    expect(matchesPath("/projekt/A/b/c/x.md", "/projekt/A/")).toBe(true);
    expect(matchesPath("/projekt/AB/x.md", "/projekt/A/")).toBe(false);
    expect(matchesPath("/any.md", "/")).toBe(true);
  });

  it("without trailing '/' means exactly one file", () => {
    expect(matchesPath("/a.md", "/a.md")).toBe(true);
    expect(matchesPath("/a.md.bak/x.md", "/a.md")).toBe(false);
    expect(matchesPath("/server/x.md", "/server")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(matchesPath("/Notes/x.md", "/notes/")).toBe(false);
  });
});

describe("inScope", () => {
  it("ORs paths, then removes excluded ones", () => {
    const scope = { paths: ["/a/", "/b.md"], excludePaths: ["/a/draft/", "/a/x.md"] };
    expect(["/a/y.md", "/a/draft/z.md", "/a/x.md", "/b.md", "/c.md"].filter((p) => inScope(p, scope))).toEqual([
      "/a/y.md",
      "/b.md",
    ]);
  });

  it("no paths = everything but the excluded", () => {
    expect(inScope("/x.md", {})).toBe(true);
    expect(inScope("/x.md", { excludePaths: ["/x.md"] })).toBe(false);
  });
});

describe("hasTag", () => {
  it("compares case-insensitively; no tag = match", () => {
    expect(hasTag(["Ops"], "ops")).toBe(true);
    expect(hasTag(["ops"], " OPS ")).toBe(true);
    expect(hasTag([], "ops")).toBe(false);
    expect(hasTag([], undefined)).toBe(true);
  });
});

describe("validateScope", () => {
  it("throws InvalidPathError for any broken path", () => {
    expect(() => validateScope({ paths: ["/ok/"], excludePaths: ["/a/../b/"] })).toThrow(InvalidPathError);
    expect(() => validateScope({ paths: ["server/"] })).toThrow("invalid path 'server/': must start with '/'");
    expect(() => validateScope({ paths: ["/"], excludePaths: ["/x.md"] })).not.toThrow();
  });
});
