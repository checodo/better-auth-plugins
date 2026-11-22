import type { AuthContext } from "@better-auth/core";

/** A deleted user, as a plugin's erase step gets it. */
export interface DeletedUser {
  id: string;
  /** `null` when the user had none. */
  email: string | null;
}

/**
 * A `user.delete.after` database hook that deletes what a plugin stores
 * about a deleted user. Foreign keys with `onDelete: "cascade"` do that on
 * some databases, but not on all adapters (MongoDB, and SQLite without
 * `PRAGMA foreign_keys`), and not for data that isn't keyed by the user
 * id (a waitlist entry is keyed by email). Errors are logged as
 * `[<pluginId>] failed to erase <what> of a deleted user`: the user is
 * already deleted, so failing the request would change nothing.
 */
export function eraseOnUserDelete(
  context: Pick<AuthContext, "logger">,
  pluginId: string,
  what: string,
  erase: (user: DeletedUser) => Promise<void>,
): (user: { id: string; email?: unknown }) => Promise<void> {
  return async (user) => {
    try {
      await erase({ id: user.id, email: typeof user.email === "string" ? user.email : null });
    } catch (error) {
      context.logger.error(`[${pluginId}] failed to erase ${what} of a deleted user`, error);
    }
  };
}

/** A user whose data is exported, as a plugin's export step gets it. */
export interface ExportedUser {
  id: string;
  /** `null` when the user has none. */
  email: string | null;
}

/**
 * What a plugin adds to a user's data export
 * (`@checodo/better-auth-data-export`), for rows the export can't find on
 * its own through the schema (a field that references `user.id`): rows
 * keyed by email, or kept without a foreign key on purpose. Keyed by
 * model, as in the plugin's schema. `null` when more than `maxRows` rows
 * match, so the export can refuse instead of running out of memory.
 *
 * A plugin exposes it as `exportUserData` on its plugin object (with
 * `Object.assign`, like the audit log's `recordEvent`); the export finds
 * it through `ctx.options.plugins`, so neither depends on the other.
 * Secrets are removed by the export, not here.
 */
export type ExportUserData = (
  user: ExportedUser,
  context: { adapter: AuthContext["adapter"]; maxRows: number },
) => Promise<Record<string, Record<string, unknown>[]> | null>;
