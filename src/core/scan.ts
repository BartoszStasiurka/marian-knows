import fg from "fast-glob";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Mount, ScanResult, ScannedFile } from "./types.js";

export const MAX_FILE_BYTES = 1024 * 1024;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** File mount beats any dir mount; among dir mounts the longest key wins. */
function rank(m: Mount): number {
  return m.kind === "file" ? Number.MAX_SAFE_INTEGER : m.key.length;
}

function ownerOf(virtualPath: string, mounts: Mount[]): Mount | undefined {
  let best: Mount | undefined;
  for (const m of mounts) {
    const hit = m.kind === "file" ? virtualPath === m.key : virtualPath.startsWith(m.key);
    if (hit && (!best || rank(m) > rank(best))) best = m;
  }
  return best;
}

interface Candidate extends ScannedFile {
  mount: Mount;
}

function admit(c: Candidate, warnings: string[]): boolean {
  const name = path.posix.basename(c.virtualPath);
  if (/[#?]/.test(name)) {
    warnings.push(`skipped ${c.virtualPath}: file name contains '#' or '?'`);
    return false;
  }
  if (c.size > MAX_FILE_BYTES) {
    warnings.push(`skipped ${c.virtualPath}: larger than 1 MB`);
    return false;
  }
  return true;
}

async function collect(mount: Mount, warnings: string[]): Promise<Candidate[]> {
  const out: Candidate[] = [];

  if (mount.kind === "file") {
    const st = await stat(mount.diskPath);
    out.push({
      virtualPath: mount.key,
      diskPath: mount.diskPath,
      mountKey: mount.key,
      size: st.size,
      mount,
    });
  } else {
    const entries = await fg(mount.recursive ? "**/*.md" : "*.md", {
      cwd: mount.diskPath,
      dot: false,
      onlyFiles: true,
      stats: true,
      objectMode: true,
      caseSensitiveMatch: false,
      suppressErrors: true,
      ignore: ["**/node_modules/**", ...mount.exclude],
    });
    for (const e of entries) {
      out.push({
        virtualPath: mount.key + e.path.normalize("NFC"),
        diskPath: path.join(mount.diskPath, e.path),
        mountKey: mount.key,
        size: e.stats?.size ?? 0,
        mount,
      });
    }
  }
  return out.filter((c) => admit(c, warnings));
}

/**
 * Resolves mounts into the final set of indexable files (virtual path -> disk path).
 * Pure diagnostics for now: no index is written.
 */
export async function scanMounts(mounts: Mount[]): Promise<ScanResult> {
  const warnings: string[] = [];
  const live = mounts.filter((m) => m.exists);

  for (const m of mounts) {
    if (!m.exists) warnings.push(`mount ${m.key}: path does not exist: ${m.diskPath}`);
  }

  const candidates: Candidate[] = [];
  for (const m of live) candidates.push(...(await collect(m, warnings)));

  // Overlap: the mount that owns a virtual path decides whether the file exists.
  const kept: Candidate[] = [];
  const shadowed = new Map<string, { owner: string; victim: string; n: number }>();
  for (const c of candidates) {
    const owner = ownerOf(c.virtualPath, live);
    if (owner === c.mount) {
      kept.push(c);
      continue;
    }
    const id = `${owner?.key}\0${c.mount.key}`;
    const rec = shadowed.get(id) ?? { owner: owner?.key ?? "?", victim: c.mount.key, n: 0 };
    rec.n += 1;
    shadowed.set(id, rec);
  }
  for (const { owner, victim, n } of shadowed.values()) {
    warnings.push(`mount ${owner} overshadows ${n} file(s) from mount ${victim}`);
  }

  // Case collisions within one virtual directory: first (code point order) wins.
  const groups = new Map<string, Candidate[]>();
  for (const c of kept) {
    const id = `${path.posix.dirname(c.virtualPath)}\0${path.posix.basename(c.virtualPath).toLowerCase()}`;
    const g = groups.get(id) ?? [];
    g.push(c);
    groups.set(id, g);
  }
  const files: Candidate[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => cmp(a.virtualPath, b.virtualPath));
    files.push(g[0]!);
    for (const loser of g.slice(1)) {
      warnings.push(`skipped ${loser.virtualPath}: name differs only by case from ${g[0]!.virtualPath}`);
    }
  }

  files.sort((a, b) => cmp(a.virtualPath, b.virtualPath));

  for (const m of live) {
    if (!files.some((f) => f.mount === m)) warnings.push(`mount ${m.key}: no matching files`);
  }

  return {
    files: files.map(({ virtualPath, diskPath, mountKey, size }) => ({
      virtualPath,
      diskPath,
      mountKey,
      size,
    })),
    warnings,
  };
}
