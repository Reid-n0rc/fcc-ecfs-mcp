import { defineConfig } from "vitest/config";

// Live document download through headless Chrome. Local only (see the test file).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live-download/**/*.test.ts"],
    testTimeout: 120_000,
    retry: 1,
  },
});
