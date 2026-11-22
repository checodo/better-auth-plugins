import type { AuthContext, BetterAuthPlugin } from "@better-auth/core";
import type { ExportUserData } from "@repo/plugin-utils/user-data";
import { createAuthMiddleware } from "better-auth/api";
import { mergeSchema } from "better-auth/db";
import { version } from "../package.json";
import { createCleanup } from "./cleanup";
import { WAITLIST_ERROR_CODES } from "./error-codes";
import { createDatabaseHooks } from "./hooks/database";
import { resolveOptions } from "./options";
import { createAdminEndpoints } from "./routes/admin";
import { createCleanupEndpoints } from "./routes/cleanup";
import { createJoinEndpoints } from "./routes/join";
import { waitlistSchema } from "./schema";
import { findEntryByEmail } from "./store";
import type { WaitlistOptions } from "./types";
import { normalizeEmail } from "./utils/email";

export { WAITLIST_ERROR_CODES, type WaitlistErrorCode } from "./error-codes";
export type {
  WaitlistAdminEntry,
  WaitlistConfirmation,
  WaitlistEntry,
  WaitlistEntryStatus,
  WaitlistInvite,
  WaitlistJoinedEntry,
  WaitlistOptions,
  WaitlistRetention,
} from "./types";

/**
 * Public endpoints anyone can call, so they are rate limited more strictly.
 * Apps can change this with better-auth's `rateLimit.customRules`.
 */
const PUBLIC_PATHS = new Set([
  "/waitlist/join",
  "/waitlist/confirm",
  "/waitlist/get-status",
  "/waitlist/leave",
  "/waitlist/check-invite",
]);

/**
 * Gates sign-up behind a waitlist: people join with their email and confirm
 * it (double opt-in), admins approve them, and only approved emails can
 * create an account, whichever sign-in method they use.
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { waitlist } from "@checodo/better-auth-waitlist";
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     waitlist({
 *       sendConfirmationEmail: async ({ email, token }) => {
 *         await sendEmail({ to: email, text: `https://example.com/waitlist/confirm?token=${token}` });
 *       },
 *       sendInvite: async ({ email, inviteCode }) => {
 *         await sendEmail({ to: email, text: `https://example.com/sign-up?invite=${inviteCode}` });
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export const waitlist = (options: WaitlistOptions = {}) => {
  const resolved = resolveOptions(options);
  const cleanup = createCleanup(resolved);

  const plugin = {
    id: "waitlist",
    version,
    init(ctx) {
      return { options: { databaseHooks: createDatabaseHooks(ctx, resolved) } };
    },
    // mergeSchema changes the object it gets, so each instance gets a copy.
    schema: mergeSchema(structuredClone(waitlistSchema), options.schema),
    endpoints: {
      ...createJoinEndpoints(resolved),
      ...createAdminEndpoints(resolved),
      ...createCleanupEndpoints(cleanup),
    },
    hooks: {
      before: [
        {
          // Any waitlist request may start a cleanup in the background.
          matcher: (context) => !!context.path?.startsWith("/waitlist/"),
          handler: createAuthMiddleware(async (ctx) => {
            cleanup.maybeSweep(ctx.context);
          }),
        },
      ],
    },
    rateLimit: [{ pathMatcher: (path) => PUBLIC_PATHS.has(path), window: 60, max: 5 }],
    $ERROR_CODES: WAITLIST_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;

  /**
   * The user's waitlist entry, for `@checodo/better-auth-data-export`: it
   * is keyed by email, so the export can't find it on its own.
   */
  const exportUserData = (async (
    user: { id: string; email: string | null },
    { adapter }: { adapter: AuthContext["adapter"]; maxRows: number },
  ): Promise<Record<string, Record<string, unknown>[]> | null> => {
    if (!user.email) return { waitlistEntry: [] };
    const entry = await findEntryByEmail(adapter, normalizeEmail(user.email));
    return { waitlistEntry: entry ? [entry as unknown as Record<string, unknown>] : [] };
  }) satisfies ExportUserData;
  return Object.assign(plugin, { exportUserData });
};

export type WaitlistPlugin = ReturnType<typeof waitlist>;

/** Lets `auth.$context.getPlugin("waitlist")` infer this plugin's exact type. */
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    waitlist: {
      creator: typeof waitlist;
    };
  }
}
