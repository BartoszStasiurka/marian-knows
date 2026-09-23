import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, scanMounts } from "../src/core/index.js";
import { makeTree } from "./helpers.js";

async function scan(dir: string, yaml: string) {
  const file = path.join(dir, "marian-knows.yml");
  writeFileSync(file, yaml);
  return scanMounts(loadConfig(file).mounts);
}

const paths = (r: { files: { virtualPath: string }[] }) => r.files.map((f) => f.virtualPath);

describe("scanMounts", () => {
  it("scans a recursive directory and maps to virtual paths", async () => {
    const dir = makeTree({ "docs/a.md": "", "docs/sub/b.md": "", "docs/ignored.txt": "" });
    const r = await scan(dir, "sources:\n  /:\n    path: ./docs\n");
    expect(paths(r)).toEqual(["/a.md", "/sub/b.md"]);
    expect(r.files[0]!.diskPath).toBe(path.join(dir, "docs", "a.md"));
  });

  it("respects recursive: false", async () => {
    const dir = makeTree({ "d/a.md": "", "d/sub/b.md": "" });
    const r = await scan(dir, "sources:\n  /d/:\n    path: ./d\n    recursive: false\n");
    expect(paths(r)).toEqual(["/d/a.md"]);
  });

  it("applies exclude globs relative to path", async () => {
    const dir = makeTree({ "d/a.md": "", "d/legacy/old.md": "", "d/x/legacy/old2.md": "" });
    const r = await scan(dir, `sources:\n  /d/:\n    path: ./d\n    exclude: ["**/legacy/**"]\n`);
    expect(paths(r)).toEqual(["/d/a.md"]);
  });

  it("skips hidden entries and node_modules", async () => {
    const dir = makeTree({
      "d/a.md": "",
      "d/.hidden.md": "",
      "d/.git/x.md": "",
      "d/node_modules/pkg/readme.md": "",
    });
    const r = await scan(dir, "sources:\n  /d/:\n    path: ./d\n");
    expect(paths(r)).toEqual(["/d/a.md"]);
  });

  it("skips files over 1 MB with a warning", async () => {
    const dir = makeTree({ "d/small.md": "x", "d/big.md": "a".repeat(1024 * 1024 + 1) });
    const r = await scan(dir, "sources:\n  /d/:\n    path: ./d\n");
    expect(paths(r)).toEqual(["/d/small.md"]);
    expect(r.warnings.some((w) => w.includes("/d/big.md") && w.includes("1 MB"))).toBe(true);
  });

  it("skips names containing # or ?", async () => {
    const dir = makeTree({ "d/ok.md": "", "d/c#.md": "" });
    const r = await scan(dir, "sources:\n  /d/:\n    path: ./d\n");
    expect(paths(r)).toEqual(["/d/ok.md"]);
    expect(r.warnings.some((w) => w.includes("'#' or '?'"))).toBe(true);
  });

  it("supports single-file mounts", async () => {
    const dir = makeTree({ "README.md": "# hi" });
    const r = await scan(dir, "sources:\n  /README.md:\n    path: ./README.md\n");
    expect(paths(r)).toEqual(["/README.md"]);
  });

  it("normalizes file names to NFC", async () => {
    const nfd = "zo\u0301łw.md"; // "ó" as o + combining acute
    const dir = makeTree({ [`d/${nfd}`]: "" });
    const r = await scan(dir, "sources:\n  /d/:\n    path: ./d\n");
    expect(paths(r)).toEqual(["/d/zółw.md"]);
  });

  it("warns about missing paths and empty mounts", async () => {
    const dir = makeTree({ "empty/readme.txt": "" });
    const r = await scan(
      dir,
      "sources:\n  /nope/:\n    path: ./nope\n  /empty/:\n    path: ./empty\n",
    );
    expect(r.files).toEqual([]);
    expect(r.warnings.some((w) => w.includes("/nope/") && w.includes("does not exist"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("/empty/") && w.includes("no matching files"))).toBe(true);
  });

  it("sorts output by virtual path", async () => {
    const dir = makeTree({ "d/b.md": "", "d/a.md": "", "d/c/z.md": "" });
    const r = await scan(dir, "sources:\n  /:\n    path: ./d\n");
    expect(paths(r)).toEqual(["/a.md", "/b.md", "/c/z.md"]);
  });
});

describe("mount overlap", () => {
  it("longest prefix wins and shadowed files are counted", async () => {
    const dir = makeTree({
      "all/server/x.md": "from root",
      "all/server/y.md": "from root",
      "all/other.md": "",
      "srv/x.md": "from server",
    });
    const r = await scan(
      dir,
      "sources:\n  /:\n    path: ./all\n  /server/:\n    path: ./srv\n",
    );
    expect(paths(r)).toEqual(["/other.md", "/server/x.md"]);
    expect(r.files.find((f) => f.virtualPath === "/server/x.md")!.diskPath).toBe(path.join(dir, "srv", "x.md"));
    expect(r.warnings).toContain("mount /server/ overshadows 2 file(s) from mount /");
  });

  it("does not treat /server/ as a prefix of /server2/", async () => {
    const dir = makeTree({ "all/server2/a.md": "", "srv/b.md": "" });
    const r = await scan(dir, "sources:\n  /:\n    path: ./all\n  /server/:\n    path: ./srv\n");
    expect(paths(r)).toEqual(["/server/b.md", "/server2/a.md"]);
  });

  it("the owning mount's exclude hides files from broader mounts", async () => {
    const dir = makeTree({ "all/server/legacy/old.md": "", "all/server/new.md": "", "srv/x.md": "" });
    const r = await scan(
      dir,
      `sources:\n  /:\n    path: ./all\n  /server/:\n    path: ./srv\n    exclude: ["**/legacy/**"]\n`,
    );
    expect(paths(r)).toEqual(["/server/x.md"]);
  });

  it("a file mount beats a directory mount for the same path", async () => {
    const dir = makeTree({ "all/README.md": "dir", "readme-real.md": "file" });
    const r = await scan(
      dir,
      "sources:\n  /:\n    path: ./all\n  /README.md:\n    path: ./readme-real.md\n",
    );
    expect(paths(r)).toEqual(["/README.md"]);
    expect(r.files[0]!.diskPath).toBe(path.join(dir, "readme-real.md"));
  });

  it("a missing mount shadows nothing", async () => {
    const dir = makeTree({ "all/server/x.md": "" });
    const r = await scan(dir, "sources:\n  /:\n    path: ./all\n  /server/:\n    path: ./missing\n");
    expect(paths(r)).toEqual(["/server/x.md"]);
  });
});

describe("case collisions", () => {
  it("keeps the first name in code point order and warns", async () => {
    const dir = makeTree();
    mkdirSync(path.join(dir, "d"));
    writeFileSync(path.join(dir, "d", "a.md"), "1");
    writeFileSync(path.join(dir, "d", "A.md"), "2");
    if (readdirSync(path.join(dir, "d")).length < 2) return; // case-insensitive filesystem
    const r = await scan(dir, "sources:\n  /d/:\n    path: ./d\n");
    expect(paths(r)).toEqual(["/d/A.md"]);
    expect(r.warnings.some((w) => w.includes("/d/a.md") && w.includes("case"))).toBe(true);
  });
});
