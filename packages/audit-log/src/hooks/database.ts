import type { AuthContext, BetterAuthOptions, GenericEndpointContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import type { EventDetails, Recorder } from "../recorder";
import { signInMethod } from "../utils/method";

/** Endpoints that verify an email address (not OAuth sign-ins, which rewrite the flag). */
const VERIFY_EMAIL_PATHS = new Set(["/verify-email", "/email-otp/verify-email"]);

/**
 * How long a new user's id is remembered, so the account created with the
 * user (same request, milliseconds later) isn't recorded as a link.
 */
const NEW_USER_TTL = 10_000;

type Context = GenericEndpointContext | null | undefined;
interface UpdateFlags {
  emailChanged: string | null;
  emailVerified: boolean;
  /** The new `twoFactorEnabled` (two-factor plugin), if this update changes it. */
  twoFactor: boolean | null;
  /** The user whose `twoFactorEnabled` it changes. */
  twoFactorUserId: string | null;
}

/**
 * The user an update is for, as far as the request tells: the target of
 * the admin plugin's `updateUser`, otherwise the signed-in user (the
 * two-factor plugin changes the user's own setting).
 */
function updatedUserId(context: GenericEndpointContext): string | null {
  if (context.path === "/admin/update-user") {
    const userId = (context.body as { userId?: unknown } | undefined)?.userId;
    return typeof userId === "string" ? userId : null;
  }
  return context.context.session?.user.id ?? null;
}

/**
 * Events about users and accounts, recorded however they happen (any
 * endpoint, any plugin, server-side calls): sign-ups, deleted users,
 * linked accounts, changed and verified emails, two-factor turned on or off.
 */
export function createDatabaseHooks(
  authContext: AuthContext,
  recorder: Recorder,
): BetterAuthOptions["databaseHooks"] {
  const contextFor = (context: Context) => context?.context ?? authContext;
  const headersOf = (context: Context) => context?.request?.headers ?? context?.headers ?? null;
  /** The signed-in user acting, e.g. an admin; `fallback` when nobody is signed in. */
  const actor = (context: Context, fallback: string) =>
    context?.context.session?.user.id ?? fallback;

  const newUsers = new Map<string, number>();
  const rememberNewUser = (userId: string) => {
    const now = Date.now();
    for (const [id, at] of newUsers) if (now - at > NEW_USER_TTL) newUsers.delete(id);
    newUsers.set(userId, now);
  };
  const wasJustCreated = (userId: string) => {
    const at = newUsers.get(userId);
    newUsers.delete(userId);
    return at !== undefined && Date.now() - at <= NEW_USER_TTL;
  };

  // `user.update.after` gets the updated user but not the changed fields, so
  // `before` notes them per request, in order (one request can update twice).
  const pendingUpdates = new WeakMap<object, UpdateFlags[]>();

  const record = (context: Context, details: EventDetails) =>
    recorder.record(contextFor(context), details, headersOf(context));

  return {
    user: {
      create: {
        after: async (user, context) => {
          rememberNewUser(user.id);
          await record(context, {
            type: "sign-up",
            userId: user.id,
            actorUserId: actor(context, user.id),
            metadata: {
              method: signInMethod(
                context?.path,
                context?.params as Record<string, unknown> | undefined,
                context?.body as Record<string, unknown> | undefined,
              ),
            },
          });
        },
      },
      update: {
        before: async (data, context) => {
          if (!context) return;
          const flags: UpdateFlags = {
            emailChanged: null,
            emailVerified: false,
            twoFactor: null,
            twoFactorUserId: null,
          };
          try {
            if (typeof data.email === "string") {
              // better-auth sometimes writes an unchanged email back; emails
              // are unique, so a user that already has it means unchanged.
              const email = data.email.toLowerCase();
              const adapter = await getCurrentAdapter(contextFor(context).adapter);
              const owner = await adapter.findOne({
                model: "user",
                where: [{ field: "email", value: email }],
              });
              if (!owner) flags.emailChanged = email;
            }
            flags.emailVerified =
              !flags.emailChanged &&
              data.emailVerified === true &&
              VERIFY_EMAIL_PATHS.has(context.path ?? "");
            // Turned on (after the first verified code) or off: compare with
            // the stored value of the user it is for, not the session's,
            // which belongs to an admin or can be a stale cookie cache.
            const twoFactorUserId =
              typeof data.twoFactorEnabled === "boolean" ? updatedUserId(context) : null;
            if (twoFactorUserId) {
              const adapter = await getCurrentAdapter(contextFor(context).adapter);
              const stored = await adapter.findOne<{ twoFactorEnabled?: unknown }>({
                model: "user",
                where: [{ field: "id", value: twoFactorUserId }],
              });
              if (stored && (stored.twoFactorEnabled === true) !== data.twoFactorEnabled) {
                flags.twoFactor = data.twoFactorEnabled as boolean;
                flags.twoFactorUserId = twoFactorUserId;
              }
            }
          } catch (error) {
            contextFor(context).logger.error("[audit-log] failed to inspect a user update", error);
          }
          const queue = pendingUpdates.get(context) ?? [];
          queue.push(flags);
          pendingUpdates.set(context, queue);
        },
        after: async (user, context) => {
          if (!context || !user) return;
          const flags = pendingUpdates.get(context)?.shift();
          if (!flags) return;
          // A stale entry (another plugin cancelled an update) doesn't match.
          if (flags.emailChanged && user.email?.toLowerCase() === flags.emailChanged) {
            await record(context, {
              type: "email-changed",
              userId: user.id,
              actorUserId: actor(context, user.id),
              metadata: { email: flags.emailChanged },
            });
          } else if (flags.emailVerified) {
            await record(context, {
              type: "email-verified",
              userId: user.id,
              actorUserId: user.id,
            });
          }
          const twoFactorEnabled = (user as { twoFactorEnabled?: unknown }).twoFactorEnabled;
          if (
            flags.twoFactor !== null &&
            user.id === flags.twoFactorUserId &&
            twoFactorEnabled === flags.twoFactor
          ) {
            await record(context, {
              type: flags.twoFactor ? "two-factor-enabled" : "two-factor-disabled",
              userId: user.id,
              actorUserId: actor(context, user.id),
            });
          }
        },
      },
      delete: {
        after: async (user, context) => {
          await record(context, {
            type: "user-deleted",
            userId: user.id,
            actorUserId: actor(context, user.id),
          });
        },
      },
    },
    account: {
      create: {
        after: async (account, context) => {
          // The first account of a new user is part of the sign-up.
          if (wasJustCreated(account.userId)) return;
          await record(context, {
            type: "account-linked",
            userId: account.userId,
            actorUserId: actor(context, account.userId),
            metadata: { providerId: account.providerId },
          });
        },
      },
    },
  };
}
