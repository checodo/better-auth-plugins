import type { AuthContext, GenericEndpointContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";

/** Endpoints that verify an email address (not OAuth sign-ins, which rewrite the flag). */
const VERIFY_EMAIL_PATHS = new Set(["/verify-email", "/email-otp/verify-email"]);

type Context = GenericEndpointContext | null | undefined;

/** What a user update changed, as far as it matters for security events. */
export interface UserChange {
  /** The updated user. */
  userId: string;
  /**
   * The email changed. `from` is the previous email, when the request
   * tells whose email it is (`null` otherwise); `to` is lowercased.
   */
  email: { from: string | null; to: string } | null;
  /** An email verification endpoint marked the (unchanged) email as verified. */
  emailVerified: boolean;
  /** The new `twoFactorEnabled` (two-factor plugin), if this update changed it. */
  twoFactor: boolean | null;
}

interface Pending {
  userId: string | null;
  email: { from: string | null; to: string } | null;
  emailVerified: boolean;
  twoFactor: boolean | null;
}

/** The payload of a JWT, without verifying it (only for tokens better-auth has verified). */
function jwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    // atob, not Buffer: the plugins also run outside Node.
    const binary = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The user an update is for, as far as the request tells: the target of
 * the admin plugin's `updateUser`, the user bound to an email-change
 * token (`/verify-email`, which better-auth has verified before it
 * updates anything), otherwise the signed-in user (the two-factor plugin
 * and the change-email endpoints change the user's own data).
 */
export function updatedUserId(context: GenericEndpointContext): string | null {
  if (context.path === "/admin/update-user") {
    const userId = (context.body as { userId?: unknown } | undefined)?.userId;
    return typeof userId === "string" ? userId : null;
  }
  if (context.path === "/verify-email") {
    const token = (context.query as { token?: unknown } | undefined)?.token;
    const userId = jwtPayload(token)?.userId;
    if (typeof userId === "string" && userId !== "") return userId;
  }
  return context.context.session?.user.id ?? null;
}

/**
 * Tells what a user update changed. `user.update.before` gets the changed
 * fields but not the user, and `user.update.after` gets the updated user
 * but not the changes, so `before` notes them per request, in order (one
 * request can update twice), and `after` hands them out.
 *
 * Create one per plugin instance (in `init`); it holds no module state.
 */
export function createUserChangeTracker(authContext: Pick<AuthContext, "adapter" | "logger">) {
  const pending = new WeakMap<object, Pending[]>();
  const adapterOf = (context: Context) =>
    getCurrentAdapter((context?.context ?? authContext).adapter);

  return {
    /** Call from `databaseHooks.user.update.before`. Never throws. */
    async before(data: Record<string, unknown>, context: Context, pluginId: string): Promise<void> {
      if (!context) return;
      const change: Pending = { userId: null, email: null, emailVerified: false, twoFactor: null };
      // Only email and two-factor changes need the stored user.
      const relevant = typeof data.email === "string" || typeof data.twoFactorEnabled === "boolean";
      try {
        const userId = updatedUserId(context);
        change.userId = userId;
        const adapter = await adapterOf(context);
        const stored =
          userId && relevant
            ? await adapter.findOne<{ email?: unknown; twoFactorEnabled?: unknown }>({
                model: "user",
                where: [{ field: "id", value: userId }],
              })
            : null;

        if (typeof data.email === "string") {
          // better-auth sometimes writes an unchanged email back.
          const to = data.email.toLowerCase();
          if (stored) {
            const from = typeof stored.email === "string" ? stored.email.toLowerCase() : null;
            if (from !== to) change.email = { from, to };
          } else {
            // Whose email it is isn't known: emails are unique, so a user
            // that already has it means unchanged.
            const owner = await adapter.findOne({
              model: "user",
              where: [{ field: "email", value: to }],
            });
            if (!owner) change.email = { from: null, to };
          }
        }
        change.emailVerified =
          !change.email &&
          data.emailVerified === true &&
          VERIFY_EMAIL_PATHS.has(context.path ?? "");
        // Turned on (after the first verified code) or off: compare with
        // the stored value of the user it is for, not the session's,
        // which belongs to an admin or can be a stale cookie cache.
        if (typeof data.twoFactorEnabled === "boolean" && stored) {
          if ((stored.twoFactorEnabled === true) !== data.twoFactorEnabled) {
            change.twoFactor = data.twoFactorEnabled;
          }
        }
      } catch (error) {
        (context.context ?? authContext).logger.error(
          `[${pluginId}] failed to inspect a user update`,
          error,
        );
      }
      const queue = pending.get(context) ?? [];
      queue.push(change);
      pending.set(context, queue);
    },

    /**
     * Call from `databaseHooks.user.update.after`: what the matching
     * `before` noted, checked against the updated user, or `null`.
     */
    after(user: { id: string; email?: string | null } | null, context: Context): UserChange | null {
      if (!context || !user) return null;
      const change = pending.get(context)?.shift();
      if (!change) return null;
      // A stale entry (another plugin cancelled an update) doesn't match.
      if (change.userId && change.userId !== user.id) return null;
      const email =
        change.email && user.email?.toLowerCase() === change.email.to ? change.email : null;
      const twoFactorEnabled = (user as { twoFactorEnabled?: unknown }).twoFactorEnabled;
      const twoFactor =
        change.twoFactor !== null && change.userId && twoFactorEnabled === change.twoFactor
          ? change.twoFactor
          : null;
      if (!email && !change.emailVerified && twoFactor === null) return null;
      return { userId: user.id, email, emailVerified: change.emailVerified, twoFactor };
    },
  };
}

export type UserChangeTracker = ReturnType<typeof createUserChangeTracker>;

/**
 * How long a new user's id is remembered, so the account created with the
 * user (same request, milliseconds later) isn't taken for a linked account.
 */
const NEW_USER_TTL = 10_000;

/**
 * Remembers users created in the last few seconds, so
 * `databaseHooks.account.create.after` can tell the first account of a
 * sign-up from an account linked later. Create one per plugin instance.
 */
export function createNewUserMemory() {
  const newUsers = new Map<string, number>();
  return {
    /** Call from `databaseHooks.user.create.after`. */
    remember(userId: string): void {
      const now = Date.now();
      for (const [id, at] of newUsers) if (now - at > NEW_USER_TTL) newUsers.delete(id);
      newUsers.set(userId, now);
    },
    /** Whether the user was just created; forgets it (one account per sign-up). */
    wasJustCreated(userId: string): boolean {
      const at = newUsers.get(userId);
      newUsers.delete(userId);
      return at !== undefined && Date.now() - at <= NEW_USER_TTL;
    },
  };
}
