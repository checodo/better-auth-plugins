import type { ViteUserConfig } from "vitest/config";
import { defineConfig } from "vitest/config";

/**
 * Shared Vitest config factory for plugin packages.
 *
 * `overrides.test` is merged into the defaults; every other key in
 * `overrides` replaces the default.
 */
export function defineLibraryTestConfig(overrides?: ViteUserConfig): ViteUserConfig {
  return defineConfig({
    ...overrides,
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
      testTimeout: 10_000,
      ...overrides?.test,
    },
  });
}
