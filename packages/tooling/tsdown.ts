import type { UserConfig } from "tsdown";
import { defineConfig } from "tsdown";

/**
 * Shared tsdown build config factory for plugin packages.
 *
 * Every plugin publishes two entry points by default: the server plugin
 * (`.`) and the client plugin (`./client`). Add more entries (e.g. `types`)
 * when a plugin needs them.
 *
 * Everything listed in the package's `dependencies` and `peerDependencies`
 * (e.g. `better-auth`, `@better-auth/core`) is kept external automatically.
 * Pass `neverBundle` only for imports that are not declared there.
 *
 * With `"type": "module"` in the package's `package.json`, output files use
 * `.js` / `.d.ts` extensions.
 */
export function defineLibraryConfig(options?: {
  entry?: Record<string, string>;
  neverBundle?: (string | RegExp)[];
}): UserConfig {
  const entry = options?.entry ?? {
    index: "src/index.ts",
    client: "src/client.ts",
  };

  return defineConfig({
    entry,
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    platform: "neutral",
    ...(options?.neverBundle ? { deps: { neverBundle: options.neverBundle } } : {}),
  });
}
