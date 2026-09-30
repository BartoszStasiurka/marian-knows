import { describe, expect, it } from "vitest";
import { list } from "../src/core/index.js";
import { makeTree } from "./helpers.js";
import { TOP_K, evaluate, formatReport, indexFixture, loadQueries } from "./quality.js";

/**
 * Regression floors for the quality set. Raise them when a change improves the numbers;
 * a drop below means ranking got worse (see the printed report for which queries moved).
 */
const MIN_HIT_RATE = 1;
const MIN_MRR = 0.94;

describe("search quality", () => {
  it(`hit@${TOP_K} and MRR stay above the floors`, async () => {
    const config = await indexFixture(makeTree());
    const queries = loadQueries();

    // A typo in `expect` would silently count as a miss.
    const indexed = new Set(list(config).docs.map((i) => i.path));
    for (const q of queries) for (const p of q.expect) expect(indexed, `${q.query}: ${p}`).toContain(p);

    const report = evaluate(config, queries);
    console.log(formatReport(report));
    expect(report.hitRate).toBeGreaterThanOrEqual(MIN_HIT_RATE);
    expect(report.mrr).toBeGreaterThanOrEqual(MIN_MRR);
  });
});
