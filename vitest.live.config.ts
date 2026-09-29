import "dotenv/config";
import { defineConfig } from "vitest/config";

// Live tests against the real ECFS API. Reads ECFS_API_KEY from the environment
// (or a local .env); fails rather than skips when it's missing.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    retry: 2,
  },
});
