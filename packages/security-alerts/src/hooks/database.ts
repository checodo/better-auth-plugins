import type { AuthContext, BetterAuthOptions } from "@better-auth/core";
import type { User } from "@better-auth/core/db";
import { createNewUserMemory, createUserChangeTracker } from "@repo/plugin-utils/user-changes";
import type { Alerter } from "../alerts";
import { PLUGIN_ID } from "../alerts";
import { deleteDevices } from "../devices";

/** Providers whose accounts aren't "linked accounts": the password is its own alert. */
const NOT_LINKED_PROVIDERS = new Set(["credential"]);

/** Masks an email for people other than its owner: `j***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/**
 * Alerts about users and accounts, however they change (any endpoint, any
 * plugin, server-side calls with a request): changed emails, two-factor
 * turned off, linked accounts. Also forgets a deleted user's devices
 * (databases without foreign keys don't cascade).
 */
export function createDatabaseHooks(
  authContext: AuthContext,
  alert: Alerter,
): BetterAuthOptions["databaseHooks"] {
  const userChanges = createUserChangeTracker(authContext);
  const newUsers = createNewUserMemory();

  return {
    user: {
      create: {
        after: async (user) => {
          newUsers.remember(user.id);
        },
      },
      update: {
        before: async (data, context) => {
          await userChanges.before(data, context, PLUGIN_ID);
        },
        after: async (user, context) => {
          const change = userChanges.after(user, context);
          if (!change || !user) return;
          const updated = user as User & Record<string, unknown>;
          if (change.email) {
            const from = change.email.from;
            if (from) {
              await alert(authContext, context, {
                type: "email-changed",
                userId: change.userId,
                user: updated,
                email: from,
                details: { newEmail: maskEmail(change.email.to) },
              });
            } else {
              authContext.logger.warn(
                `[${PLUGIN_ID}] the email of user ${change.userId} changed, but the old address isn't known: no email-changed alert`,
              );
            }
          }
          if (change.twoFactor === false) {
            await alert(authContext, context, {
              type: "two-factor-disabled",
              userId: change.userId,
              user: updated,
            });
          }
        },
      },
      delete: {
        after: async (user) => {
          try {
            await deleteDevices(authContext.adapter, user.id);
          } catch (error) {
            authContext.logger.error(
              `[${PLUGIN_ID}] failed to forget a deleted user's devices`,
              error,
            );
          }
        },
      },
    },
    account: {
      create: {
        after: async (account, context) => {
          // The first account of a new user is part of the sign-up.
          if (newUsers.wasJustCreated(account.userId)) return;
          if (NOT_LINKED_PROVIDERS.has(account.providerId)) return;
          await alert(authContext, context, {
            type: "account-linked",
            userId: account.userId,
            details: { providerId: account.providerId },
            undo: { model: "account", id: account.id },
          });
        },
      },
    },
  };
}
