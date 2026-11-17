import type { AuthContext, BetterAuthOptions, GenericEndpointContext } from "@better-auth/core";
import { createNewUserMemory, createUserChangeTracker } from "@repo/plugin-utils/user-changes";
import type { EventDetails, Recorder } from "../recorder";
import { signInMethod } from "../utils/method";

type Context = GenericEndpointContext | null | undefined;

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

  const newUsers = createNewUserMemory();
  const userChanges = createUserChangeTracker(authContext);

  const record = (context: Context, details: EventDetails) =>
    recorder.record(contextFor(context), details, headersOf(context));

  return {
    user: {
      create: {
        after: async (user, context) => {
          newUsers.remember(user.id);
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
          await userChanges.before(data, context, "audit-log");
        },
        after: async (user, context) => {
          const change = userChanges.after(user, context);
          if (!change) return;
          if (change.email) {
            await record(context, {
              type: "email-changed",
              userId: change.userId,
              actorUserId: actor(context, change.userId),
              metadata: { email: change.email.to },
            });
          } else if (change.emailVerified) {
            await record(context, {
              type: "email-verified",
              userId: change.userId,
              actorUserId: change.userId,
            });
          }
          if (change.twoFactor !== null) {
            await record(context, {
              type: change.twoFactor ? "two-factor-enabled" : "two-factor-disabled",
              userId: change.userId,
              actorUserId: actor(context, change.userId),
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
          if (newUsers.wasJustCreated(account.userId)) return;
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
