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
