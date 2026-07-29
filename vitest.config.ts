import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only. The browser specs are `*.spec.mjs` and belong to
    // Playwright, which vitest cannot drive.
    include: ["test/**/*.test.ts"],
  },
});
