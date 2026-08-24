import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 10000,
    setupFiles: ["tests/setup.ts"],
    // Test files share one real MySQL test database and each truncates
    // tables in beforeEach, so files must not run concurrently.
    fileParallelism: false,
  },
});
