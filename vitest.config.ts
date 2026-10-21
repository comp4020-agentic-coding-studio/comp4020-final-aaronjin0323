import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the running app, which spec/global-setup.ts
// finds. Only spec/ runs: a test anywhere else needs adding to `include`.
// CI's runner is slower than a laptop, and the realtime and log tests wait
// on streams and a spawned server, so the limit is generous.
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    testTimeout: 30_000,
  },
});
