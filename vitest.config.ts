import { defineConfig } from "vitest/config";

export default defineConfig({
  // CLI tests spawn tsx subprocesses (~1 s each) concurrently; 5 s is too tight under load.
  test: { include: ["test/**/*.test.ts"], testTimeout: 20_000 },
});
