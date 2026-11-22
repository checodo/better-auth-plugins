/** The user an export is for, as `contributors` and `onExport` get it. */
export interface DataExportUser {
  id: string;
  email: string | null;
  name: string | null;
}

/**
 * Adds the app's own data about a user (orders, uploads, ...) to the
 * export, under `app.<name>`. Return anything JSON can hold. An error
 * fails the export, so it is never silently incomplete.
 */
export type DataExportContributor = (user: DataExportUser) => unknown | Promise<unknown>;

/** Who asked for an export. */
export type DataExportVia = "user" | "admin" | "server";

/** What `onExport` gets after an export was made. */
export interface DataExportEvent {
  user: DataExportUser;
  /** The signed-in user, an admin, or server code (`auth.api.exportUserData`). */
  via: DataExportVia;
  /** The admin who made it, with `via: "admin"`; else `null`. */
  actorUserId: string | null;
  /** Rows in the export, the user included. */
  rows: number;
}

/** The export: a JSON document with everything stored about one user. */
export interface DataExport {
  /** When the export was made (ISO 8601). */
  exportedAt: string;
  /** The user row. */
  user: Record<string, unknown>;
  /** Every other row about the user, by model (`session`, `account`, `referral`, ...). */
  data: Record<string, Record<string, unknown>[]>;
  /** The app's data, from `contributors`. */
  app: Record<string, unknown>;
  /**
   * Fields left out of `user` and `data` (passwords, tokens, secrets,
   * hashes, and `omit`), by model. `["*"]` for a model left out entirely.
   */
  omitted: Record<string, string[]>;
}

/** Who may export another user's data over HTTP. */
export interface DataExportAdminOptions {
  /** Users with one of these roles (better-auth's admin plugin). Defaults to `["admin"]`. */
  adminRoles?: readonly string[] | undefined;
  /** Users with these ids, whatever their role. */
  adminUserIds?: readonly string[] | undefined;
}

export interface DataExportOptions {
  /**
   * More fields to leave out, by model, on top of the built-in ones
   * (passwords, tokens, secrets, hashes): `{ user: ["internalNote"] }`, or
   * `true` for a whole model: `{ apikey: true }`.
   */
  omit?: Record<string, readonly string[] | true> | undefined;
  /** The app's own data, by name: `{ orders: (user) => db.orders.findMany(...) }`. */
  contributors?: Record<string, DataExportContributor> | undefined;
  /**
   * Most rows one export may hold, the user included; above it the export
   * fails with `EXPORT_TOO_LARGE` instead of running out of memory.
   * Defaults to `50000`.
   */
  maxRows?: number | undefined;
  /**
   * Called after each export, e.g. to tell the user by email that one was
   * made. Runs in the background with better-auth's `backgroundTasks`;
   * errors are logged.
   */
  onExport?: ((event: DataExportEvent, request?: Request) => void | Promise<void>) | undefined;
  /**
   * Lets admins export another user's data over HTTP (`/data-export/admin`).
   * `true`: users with the `admin` role (better-auth's admin plugin); or
   * `{ adminRoles, adminUserIds }`. Off by default; server code can always
   * use `auth.api.exportUserData`.
   */
  admin?: boolean | DataExportAdminOptions | undefined;
  /**
   * Seconds since sign-in within which a session may download an export;
   * older sessions get `SESSION_NOT_FRESH` and sign in again. `0` turns
   * the check off. Defaults to better-auth's `session.freshAge` (a day).
   */
  freshAge?: number | undefined;
  /**
   * Requests per window for the export endpoints, per IP address.
   * Defaults to 3 per hour.
   */
  rateLimit?: { window: number; max: number } | undefined;
}
