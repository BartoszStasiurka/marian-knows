import { defineConfig } from "vitest/config";

export default defineConfig({
  // CLI tests spawn tsx subprocesses (~1 s each) concurrently; the longest run ~8 in sequence
  // and take ~12 s on an 8-core laptop, so 2-vCPU CI runners need far more headroom.
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});
