import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only. The browser specs are `*.spec.mjs` and belong to
    // Playwright, which vitest cannot drive.
    // `src/local` keeps its own test beside the code: it imports `node:fs`, which
    // the root project cannot typecheck against the Workers type set.
    include: ["test/**/*.test.ts", "src/local/**/*.test.ts"],
  },
});
