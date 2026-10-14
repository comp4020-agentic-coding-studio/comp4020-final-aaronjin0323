import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the running app, which spec/global-setup.ts
// finds. Only spec/ runs: a test anywhere else needs adding to `include`.
// The random-board preview test takes ~4.5 s here and ~13 s on CI's runner,
// so the default 5 s limit failed it in CI for being slow, not wrong.
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    testTimeout: 30_000,
  },
});
