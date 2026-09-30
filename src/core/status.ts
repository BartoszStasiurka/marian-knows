import { statSync } from "node:fs";
import { IndexMissingError } from "./errors.js";
import { indexPath, openIndexReadonly, readMeta } from "./indexer.js";
import type { LoadedConfig } from "./types.js";

export interface ProjectStatus {
  name: string;
  /** Disk path of the config file (diagnostic). */
  config: string;
  /** Disk path of the source directory (diagnostic). */
  path: string;
  pathExists: boolean;
  exclude: string[];
  /** `outdated`: an index from another schema version; `index` rebuilds it. */
  index: "ok" | "missing" | "outdated";
  /** The fields below are null unless `index` is `ok` (`dbSize`: whenever database files exist). */
  files: number | null;
  sections: number | null;
  /** Bytes of `index.db` plus its `-wal` and `-shm` files. */
  dbSize: number | null;
  indexedAt: string | null;
  ageSeconds: number | null;
}

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/** Project, config and index state. Never fails on a missing or outdated index. */
export function status(config: LoadedConfig, now: Date = new Date()): ProjectStatus {
  const db = indexPath(config);
  const size = ["", "-wal", "-shm"].reduce((sum, suffix) => sum + fileSize(db + suffix), 0);
  const result: ProjectStatus = {
    name: config.name,
    config: config.configPath,
    path: config.sourceDir,
    pathExists: config.sourceExists,
    exclude: config.exclude,
    index: "missing",
    files: null,
    sections: null,
    dbSize: null,
    indexedAt: null,
    ageSeconds: null,
  };

  let handle;
  try {
    handle = openIndexReadonly(config);
  } catch (e) {
    if (!(e instanceof IndexMissingError)) throw e;
    return e.outdated ? { ...result, index: "outdated", dbSize: size } : result;
  }
  try {
    const count = (table: string) => (handle.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    const indexedAt = readMeta(handle, "indexed_at") ?? null;
    const at = indexedAt === null ? NaN : Date.parse(indexedAt);
    return {
      ...result,
      index: "ok",
      files: count("docs"),
      sections: count("sections"),
      dbSize: size,
      indexedAt,
      ageSeconds: Number.isNaN(at) ? null : Math.max(0, Math.floor((now.getTime() - at) / 1000)),
    };
  } finally {
    handle.close();
  }
}
