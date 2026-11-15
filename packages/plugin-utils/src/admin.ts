/** Who counts as an admin of a plugin: the `adminRoles` and `adminUserIds` options. */
export interface AdminOptions {
  /**
   * Users with one of these roles (the `role` field of better-auth's
   * `admin` plugin) count as admins. Defaults to `["admin"]`.
   */
  adminRoles?: readonly string[] | undefined;
  /** Users with these ids count as admins, whatever their role. */
  adminUserIds?: readonly string[] | undefined;
}

export interface ResolvedAdminOptions {
  adminRoles: readonly string[];
  adminUserIds: readonly string[];
}

/** Applies the defaults of `AdminOptions`. */
export function resolveAdminOptions(options: AdminOptions): ResolvedAdminOptions {
  return {
    adminRoles: options.adminRoles ?? ["admin"],
    adminUserIds: options.adminUserIds ?? [],
  };
}

/**
 * Whether `user` is listed in `adminUserIds`, or has one of `adminRoles`
 * in the admin plugin's `role` field, which holds several roles
 * comma-separated (`"user, admin"`).
 */
export function isAdmin(user: { id: string; role?: unknown }, options: ResolvedAdminOptions) {
  if (options.adminUserIds.includes(user.id)) return true;
  if (typeof user.role !== "string") return false;
  return user.role.split(",").some((role) => options.adminRoles.includes(role.trim()));
}
