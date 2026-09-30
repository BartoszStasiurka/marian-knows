import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { loadConfig, rebuildIndex, search, type LoadedConfig } from "../src/core/index.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/quality/", import.meta.url));

/** A query counts as a hit when an expected file is within the top `TOP_K` results. */
export const TOP_K = 5;

const QuerySchema = z
  .object({
    query: z.string().min(1),
    expect: z.union([z.string(), z.array(z.string()).min(1)]).transform((e) => (Array.isArray(e) ? e : [e])),
    tag: z.string().optional(),
    exact: z.boolean().optional(),
  })
  .strict();

export type QualityQuery = z.output<typeof QuerySchema>;

export function loadQueries(): QualityQuery[] {
  const raw: unknown = parseYaml(readFileSync(path.join(FIXTURES, "queries.yml"), "utf8"));
  return z.array(QuerySchema).parse(raw);
}

/** Copies the fixture knowledge base into `dir` (an empty temp dir) and indexes it. */
export async function indexFixture(dir: string): Promise<LoadedConfig> {
  writeFileSync(path.join(dir, "marian-knows.yml"), "name: Quality\npath: ./kb\n");
  cpSync(path.join(FIXTURES, "kb"), path.join(dir, "kb"), { recursive: true });
  const config = loadConfig(path.join(dir, "marian-knows.yml"));
  await rebuildIndex(config);
  return config;
}

export interface QueryOutcome {
  query: QualityQuery;
  /** 1-based rank of the first expected file, null when it is not in the top `TOP_K`. */
  rank: number | null;
  top: string[];
}

export interface QualityReport {
  outcomes: QueryOutcome[];
  /** Share of queries with an expected file in the top `TOP_K`. */
  hitRate: number;
  /** Mean reciprocal rank within the top `TOP_K` (0 for a miss). */
  mrr: number;
}

export function evaluate(config: LoadedConfig, queries: QualityQuery[]): QualityReport {
  const outcomes = queries.map((query) => {
    const top = search(config, query.query, { limit: TOP_K, tag: query.tag, exact: query.exact }).hits.map(
      (h) => h.path,
    );
    const index = top.findIndex((p) => query.expect.includes(p));
    return { query, rank: index < 0 ? null : index + 1, top };
  });
  const n = outcomes.length || 1;
  return {
    outcomes,
    hitRate: outcomes.filter((o) => o.rank !== null).length / n,
    mrr: outcomes.reduce((sum, o) => sum + (o.rank ? 1 / o.rank : 0), 0) / n,
  };
}

export function formatReport(report: QualityReport): string {
  const hits = report.outcomes.filter((o) => o.rank !== null).length;
  const lines = [
    `quality: hit@${TOP_K} ${hits}/${report.outcomes.length} (${(report.hitRate * 100).toFixed(1)}%), ` +
      `MRR ${report.mrr.toFixed(3)}`,
  ];
  for (const o of report.outcomes) {
    if (o.rank === 1) continue;
    const mark = o.rank === null ? "miss" : `#${o.rank}`;
    lines.push(`  ${mark.padEnd(4)} ${JSON.stringify(o.query.query)} -> ${o.top.join(", ") || "(none)"}`);
  }
  return lines.join("\n");
}

// `npx tsx test/quality.ts` prints the report without vitest, for quick runs while tuning.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = mkdtempSync(path.join(tmpdir(), "marian-knows-quality-"));
  try {
    console.log(formatReport(evaluate(await indexFixture(dir), loadQueries())));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
