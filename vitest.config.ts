import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    // Establish a green unit-test baseline by excluding integration/live/DB smoke suites by default.
    // Run these explicitly via an env or separate task when the server/DB are available.
    exclude: [
      ...configDefaults.exclude,
      // Exclude Playwright-style suites entirely from Vitest discovery
      "playwright/**",
      "tests/**/*.smoke.spec.ts",
      "tests/**/*persistence*.spec.ts",
      // Exclude HTTP/integration specs that require a running server or Playwright test runner
      "tests/wa.*.spec.ts",
      "tests/**/role_login*.spec.ts",
      "tests/**/login_page_live*.spec.ts",
      "tests/**/collision.upsert.spec.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
