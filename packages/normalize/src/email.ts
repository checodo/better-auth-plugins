import type {
  AuthContext,
  BetterAuthOptions,
  BetterAuthPlugin,
  GenericEndpointContext,
} from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import { BASE_ERROR_CODES } from "@better-auth/core/error";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { createFail } from "@repo/plugin-utils/options";
import { updatedUserId } from "@repo/plugin-utils/user-changes";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { mergeSchema } from "better-auth/db";
import * as z from "zod";
import { version } from "../package.json";
import { NORMALIZE_ERROR_CODES } from "./error-codes";
import { emailNormalizationSchema } from "./schema";
import type { EmailNormalizationOptions, ResolvedEmailNormalizationOptions } from "./types";
import { normalizeEmailAddress } from "./utils/email";

export type { EmailNormalizationOptions, Subaddressing } from "./types";
export { KNOWN_PROVIDERS, normalizeEmailAddress } from "./utils/email";

const PLUGIN_ID = "normalize-email";
const fail: (message: string) => never = createFail("normalize");

/**
 * Endpoints whose `email` is an existing user's, rewritten to the stored
 * address with `allowNormalizedSignIn`: signing in, and sending and
 * checking the codes and links that sign in, verify, or reset a password.
 */
const SIGN_IN_PATHS = new Set([
  "/sign-in/email",
  "/sign-in/magic-link",
  "/sign-in/email-otp",
  "/request-password-reset",
  "/email-otp/send-verification-otp",
  "/email-otp/check-verification-otp",
  "/email-otp/verify-email",
  "/email-otp/request-password-reset",
  "/forget-password/email-otp",
  "/email-otp/reset-password",
]);

/** Most users one backfill call goes through. */
export const MAX_BACKFILL_BATCH = 1000;

interface StoredUser {
  id: string;
  email: string;
  normalizedEmail?: string | null;
}

type ExistingUserCallback = NonNullable<
  NonNullable<BetterAuthOptions["emailAndPassword"]>["onExistingUserSignUp"]
>;

type Adapter = AuthContext["adapter"];

function resolveOptions(options: EmailNormalizationOptions): ResolvedEmailNormalizationOptions {
  const subaddressing = options.subaddressing ?? "known";
  if (subaddressing !== "known" && subaddressing !== "all") {
    fail(`"subaddressing" must be "known" or "all", got ${JSON.stringify(subaddressing)}.`);
  }
  if (options.normalize !== undefined && typeof options.normalize !== "function") {
    fail('"normalize" must be a function.');
  }
  return {
    normalize: options.normalize ?? ((email) => normalizeEmailAddress(email, subaddressing)),
    allowNormalizedSignIn: options.allowNormalizedSignIn ?? false,
  };
}

function findByNormalized(adapter: Pick<Adapter, "findOne">, normalized: string) {
  return adapter.findOne<StoredUser>({
    model: "user",
    where: [{ field: "normalizedEmail", value: normalized }],
  });
}

/** Records a refused second account, if the app uses the audit log. */
function recordRefused(email: string, existingUserId: string) {
  return recordAuditEvent({
    type: "normalize.email-alias-refused",
    status: "failure",
    severity: "medium",
    userId: existingUserId,
    actorUserId: null,
    errorCode: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
    metadata: { email },
  });
}

const userExists = () =>
  APIError.from("UNPROCESSABLE_ENTITY", BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL);

/**
 * Whether better-auth answers an email sign-up for an existing email with
 * a success-shaped response instead of an error, so it doesn't tell who
 * has an account. The same condition as better-auth's.
 */
function hidesExistingUsers(options: BetterAuthOptions) {
  const emailAndPassword = options.emailAndPassword;
  return (
    Boolean(emailAndPassword?.requireEmailVerification) || emailAndPassword?.autoSignIn === false
  );
}

/**
 * Refuses an email sign-up for an inbox that has an account. Where
 * better-auth hides existing users, a 403 lets its sign-up answer exactly
 * as for an existing email: after checking the input and hashing the
 * password, with the same response (including additional fields and
 * `customSyntheticUser`). Like better-auth, it tells the owner through
 * `onExistingUserSignUp`.
 */
async function refuseSignUp(context: GenericEndpointContext, existing: StoredUser) {
  const options = context.context.options;
  if (!hidesExistingUsers(options)) throw userExists();
  const notify = options.emailAndPassword?.onExistingUserSignUp as ExistingUserCallback | undefined;
  if (notify) {
    try {
      const pending = notify({ user: existing as never }, context.request);
      const run = context.context.runInBackgroundOrAwait;
      await (typeof run === "function" ? run(pending) : pending);
    } catch (error) {
      context.context.logger.error("Failed to run onExistingUserSignUp after sign-up", error);
    }
  }
  throw APIError.from("FORBIDDEN", BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL);
}

function createDatabaseHooks(
  authContext: AuthContext,
  options: ResolvedEmailNormalizationOptions,
): BetterAuthOptions["databaseHooks"] {
  const adapterFor = (context: GenericEndpointContext | null | undefined) =>
    getCurrentAdapter(context?.context.adapter ?? authContext.adapter);

  return {
    user: {
      create: {
        // Every way of creating a user: email, social, magic link, OTP,
        // admin, server code.
        before: async (user, context) => {
          if (typeof user.email !== "string") return;
          const normalized = options.normalize(user.email);
          if (!normalized) return { data: { ...user, normalizedEmail: null } };
          const existing = await findByNormalized(await adapterFor(context), normalized);
          if (existing) {
            await recordRefused(user.email, existing.id);
            if (context?.path === "/sign-up/email") await refuseSignUp(context, existing);
            throw userExists();
          }
          return { data: { ...user, normalizedEmail: normalized } };
        },
      },
      update: {
        before: async (data, context) => {
          if (typeof data.email !== "string") return;
          const normalized = options.normalize(data.email);
          if (!normalized) return { data: { ...data, normalizedEmail: null } };
          const existing = await findByNormalized(await adapterFor(context), normalized);
          if (existing) {
            // The same user (an email change to another form of their
            // own address), or one whose email is written back unchanged.
            const self = context ? updatedUserId(context) : null;
            const same =
              existing.id === self || existing.email.toLowerCase() === data.email.toLowerCase();
            if (!same) {
              await recordRefused(data.email, existing.id);
              throw userExists();
            }
          }
          return { data: { ...data, normalizedEmail: normalized } };
        },
      },
    },
  };
}

/**
 * Normalizes every user's email (`ada+news@gmail.com` and `a.da@gmail.com`
 * become `ada@gmail.com`) into `user.normalizedEmail`, which is unique: a
 * second account for the same inbox is refused, like an exact duplicate.
 * Optionally lets people sign in with any form of their address.
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { emailNormalization } from "@checodo/better-auth-normalize/email";
 *
 * export const auth = betterAuth({
 *   plugins: [emailNormalization()],
 * });
 * ```
 */
export const emailNormalization = (options: EmailNormalizationOptions = {}) => {
  const resolved = resolveOptions(options);

  return {
    id: PLUGIN_ID,
    version,
    init(ctx) {
      return { options: { databaseHooks: createDatabaseHooks(ctx, resolved) } };
    },
    // mergeSchema changes the object it gets, so each instance gets a copy.
    schema: mergeSchema(structuredClone(emailNormalizationSchema), options.schema),
    hooks: {
      before: [
        {
          matcher: (ctx) => resolved.allowNormalizedSignIn && SIGN_IN_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as { email?: unknown } | undefined;
            if (typeof body?.email !== "string") return;
            const normalized = resolved.normalize(body.email);
            if (!normalized) return;
            const existing = await findByNormalized(ctx.context.adapter, normalized);
            if (!existing || existing.email.toLowerCase() === body.email.toLowerCase()) return;
            // Signs in to the stored address; the response is the same as
            // for any address, so nothing about other users is revealed.
            return { context: { body: { ...body, email: existing.email } } };
          }),
        },
      ],
    },
    endpoints: {
      /**
       * Server only: fills `normalizedEmail` for existing users (and
       * recomputes it after a rules change), a batch at a time. Two users
       * with the same inbox are reported in `conflicts` and keep `null`
       * until you decide which account stays.
       */
      backfillNormalizedEmails: createAuthEndpoint(
        {
          method: "POST",
          body: z.optional(
            z.object({
              afterId: z
                .string()
                .min(1)
                .optional()
                .meta({ description: "Continue after this user: a previous `nextAfterId`" }),
              limit: z
                .number()
                .int()
                .min(1)
                .max(MAX_BACKFILL_BATCH)
                .optional()
                .meta({
                  description: `Users per call, at most ${MAX_BACKFILL_BATCH}. Defaults to 500`,
                }),
            }),
          ),
          metadata: {
            openapi: { description: "Fill `normalizedEmail` for existing users. Server only" },
          },
        },
        async (ctx) => {
          const limit = ctx.body?.limit ?? 500;
          const afterId = ctx.body?.afterId;
          const adapter = ctx.context.adapter;
          const users = await adapter.findMany<StoredUser>({
            model: "user",
            where: afterId ? [{ field: "id", value: afterId, operator: "gt" }] : [],
            limit,
            sortBy: { field: "id", direction: "asc" },
          });
          let updated = 0;
          const conflicts: string[] = [];
          for (const user of users) {
            const normalized =
              typeof user.email === "string" ? resolved.normalize(user.email) : null;
            if ((user.normalizedEmail ?? null) === normalized) continue;
            let value = normalized;
            if (normalized) {
              const owner = await findByNormalized(adapter, normalized);
              if (owner && owner.id !== user.id) {
                conflicts.push(user.id);
                value = null;
                if ((user.normalizedEmail ?? null) === null) continue;
              }
            }
            await adapter.update({
              model: "user",
              where: [{ field: "id", value: user.id }],
              update: { normalizedEmail: value },
            });
            updated++;
          }
          return ctx.json({
            checked: users.length,
            updated,
            conflicts,
            nextAfterId: users.length === limit ? (users.at(-1)?.id ?? null) : null,
          });
        },
      ),
    },
    $ERROR_CODES: NORMALIZE_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;
};

export type EmailNormalizationPlugin = ReturnType<typeof emailNormalization>;

/** Lets `auth.$context.getPlugin("normalize-email")` infer this plugin's exact type. */
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "normalize-email": {
      creator: typeof emailNormalization;
    };
  }
}
