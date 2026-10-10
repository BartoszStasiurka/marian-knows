import { statSync } from "node:fs";
import { IndexLockedError } from "./errors.js";
import { syncGitSource, type GitSyncResult } from "./git.js";
import { acquireIndexLock, syncIndexLocked, type IndexOptions } from "./indexer.js";
import type { IndexResult, LoadedConfig } from "./types.js";

export interface RefreshOptions extends IndexOptions {
  /** Progress lines of the git step (`git: cloning …`, `git: … at <commit>`). */
  log?: (line: string) => void;
}

export interface RefreshResult {
  /** Null without a `git` block. */
  git: GitSyncResult | null;
  /** Null when the indexed directory is missing after the git step: the previous index stays. */
  index: IndexResult | null;
  /** Git step warnings and the not-indexing notice; the index's own warnings stay in `index.warnings`. */
  warnings: string[];
  ms: number;
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * What `index` does and what `serve` repeats: updates the git working copy (when configured), then syncs the index.
 * Both steps run under the index lock, so two runs never fetch into the same clone at once.
 * Throws IndexLockedError while another run holds the lock, GitError when the git step leaves nothing to index.
 */
export async function refreshIndex(config: LoadedConfig, options: RefreshOptions = {}): Promise<RefreshResult> {
  const started = performance.now();
  const release = acquireIndexLock(config);
  try {
    let git: GitSyncResult | null = null;
    const warnings: string[] = [];
    let current = config;
    if (config.git) {
      git = await syncGitSource(config.git, options.log ?? (() => {}));
      warnings.push(...git.warnings);
      // The config was loaded before a first clone, when the source directory did not exist yet.
      current = { ...config, sourceExists: isDirectory(config.sourceDir) };
      if (!current.sourceExists) {
        // Indexing a missing directory would empty the index; a stale base beats no base.
        warnings.push(`not indexing: ${config.sourceDir} does not exist; the previous index stays`);
        return { git, index: null, warnings, ms: performance.now() - started };
      }
    }
    const index = await syncIndexLocked(current, options);
    return { git, index, warnings, ms: performance.now() - started };
  } finally {
    release();
  }
}

export interface RefreshScheduleOptions {
  /** Gap between the end of one refresh and the start of the next; 0 = refresh only once, at start. */
  everyMs: number;
  /** Git progress and the index summary of runs worth printing. */
  log: (line: string) => void;
  warn: (message: string) => void;
  /** Called after every run, printed or not (tests, diagnostics). */
  onRun?: () => void;
}

export interface IndexRefresher {
  /** Stops the schedule and waits for a running refresh, at most `graceMs`. */
  stop(graceMs?: number): Promise<void>;
}

/** A run is printed when it is the first, when something changed, or when it has something to warn about. */
function worthPrinting(r: RefreshResult): boolean {
  if (r.warnings.length || r.index === null || r.index.warnings.length) return true;
  if (r.git && (r.git.action === "cloned" || r.git.action === "updated")) return true;
  return r.index.added + r.index.changed + r.index.removed > 0;
}

/**
 * Keeps the index fresh while the server runs: `refreshIndex` now, then again `everyMs` after each run ends, so runs
 * never overlap. Failures are warnings and the next run tries again: the server keeps serving the previous index.
 * A run that finds the lock taken (a manual `index`) is skipped.
 */
export function startIndexRefresh(config: LoadedConfig, options: RefreshScheduleOptions): IndexRefresher {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;
  let first = true;

  const runOnce = async () => {
    const lines: string[] = [];
    try {
      const r = await refreshIndex(config, { log: (line) => lines.push(line) });
      if (first || worthPrinting(r)) {
        for (const line of lines) options.log(line);
        for (const w of r.warnings) options.warn(w);
        if (r.index) {
          const { files, added, changed, removed } = r.index;
          options.log(
            `index: ${files} files, + ${added} added, ~ ${changed} changed, - ${removed} removed ` +
              `(${(r.ms / 1000).toFixed(1)} s)`,
          );
          for (const w of r.index.warnings) options.warn(w);
        }
      }
    } catch (e) {
      for (const line of lines) options.log(line);
      const message = e instanceof Error ? e.message : String(e);
      options.warn(e instanceof IndexLockedError ? `index refresh skipped: ${message}` : `index refresh failed: ${message}`);
    }
    first = false;
  };

  const tick = () => {
    timer = null;
    running = runOnce().finally(() => {
      running = null;
      options.onRun?.();
      if (!stopped && options.everyMs > 0) {
        timer = setTimeout(tick, options.everyMs);
        // The schedule alone never keeps the process alive; the server does.
        timer.unref();
      }
    });
  };
  tick();

  return {
    async stop(graceMs = Infinity) {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (!running) return;
      if (graceMs === Infinity) return running;
      let wait: NodeJS.Timeout | undefined;
      await Promise.race([running, new Promise<void>((resolve) => (wait = setTimeout(resolve, graceMs)))]);
      clearTimeout(wait);
    },
  };
}
