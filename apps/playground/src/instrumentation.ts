/**
 * Creates or updates the SQLite tables when the server starts. Uses the
 * plain config, not the auth instance, so better-auth's schema check only
 * runs once the tables exist.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureMigrated } = await import("./lib/migrate");
  await ensureMigrated();
}
