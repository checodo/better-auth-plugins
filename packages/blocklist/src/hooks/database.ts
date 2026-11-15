import type { AuthContext, BetterAuthOptions, GenericEndpointContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import { assertNotBlocked } from "../check";
import type { ResolvedBlocklistOptions } from "../types";

type Adapter = AuthContext["adapter"];

/**
 * Whether a user already has this (unique) email or username. On update,
 * that means the value isn't changing (or belongs to someone else, which
 * better-auth rejects anyway), so it isn't checked again: a rule added
 * later must not lock existing users out, for example when an OAuth
 * sign-in writes the unchanged email back to the user.
 */
async function isTaken(adapter: Adapter, field: "email" | "username", value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return false;
  const db = await getCurrentAdapter(adapter);
  const candidates = [...new Set([value, value.trim().toLowerCase()])];
  const user = await db.findOne({
    model: "user",
    where: [{ field, value: candidates, operator: "in" }],
  });
  return user !== null;
}

/**
 * Checks emails, usernames, and display usernames whenever a user is
 * created or updated, whichever endpoint does it: email sign-up, OAuth,
 * magic link, email OTP, the admin plugin, `/update-user`, or the email
 * change verification. On update, unchanged emails and usernames are
 * skipped (see `isTaken`).
 */
export function createDatabaseHooks(
  authContext: AuthContext,
  options: ResolvedBlocklistOptions,
): BetterAuthOptions["databaseHooks"] {
  const check = async (
    user: Record<string, unknown>,
    context: GenericEndpointContext | null | undefined,
    action: "create" | "update",
  ) => {
    const adapter = context?.context.adapter ?? authContext.adapter;
    const logger = context?.context.logger ?? authContext.logger;
    const changed = async (field: "email" | "username") =>
      action === "create" || !(await isTaken(adapter, field, user[field]));

    if (await changed("email")) {
      await assertNotBlocked(adapter, options, "email", user.email, { logger });
    }
    if (await changed("username")) {
      await assertNotBlocked(adapter, options, "username", user.username, { logger });
    }
    // Shown publicly by the username plugin, so held to the username rules.
    await assertNotBlocked(adapter, options, "username", user.displayUsername, { logger });
  };

  return {
    user: {
      create: {
        before: async (user, context) => {
          await check(user, context, "create");
        },
      },
      update: {
        before: async (user, context) => {
          await check(user, context, "update");
        },
      },
    },
  };
}
