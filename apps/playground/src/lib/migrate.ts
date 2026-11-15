import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "./auth-options";

let migrated: Promise<void> | undefined;

/**
 * Creates missing tables, columns, and indexes in the playground database,
 * once per server process. Called on startup (`src/instrumentation.ts`)
 * and awaited before every auth request (`app/api/auth/[...all]/route.ts`),
 * so requests never run against a database without tables.
 */
export function ensureMigrated(): Promise<void> {
  migrated ??= (async () => {
    const { toBeCreated, toBeAdded, toBeAddedIndexes, runMigrations } =
      await getMigrations(authOptions);
    if (toBeCreated.length || toBeAdded.length || toBeAddedIndexes.length) {
      await runMigrations();
      console.info("[playground] database migrated");
    }
  })().catch((error: unknown) => {
    migrated = undefined;
    throw error;
  });
  return migrated;
}
