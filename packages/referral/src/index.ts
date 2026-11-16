import type { BetterAuthPlugin } from "@better-auth/core";
import { mergeSchema } from "better-auth/db";
import { version } from "../package.json";
import { REFERRAL_ERROR_CODES } from "./error-codes";
import { createDatabaseHooks } from "./hooks/database";
import { applyAuthDefaults, resolveOptions } from "./options";
import { createCodeEndpoints } from "./routes/codes";
import { createReferralEndpoints } from "./routes/referrals";
import { referralSchema } from "./schema";
import type { ReferralOptions } from "./types";

export { REFERRAL_ERROR_CODES, type ReferralErrorCode } from "./error-codes";
export { EMAIL_VERIFIED_STEP } from "./options";
export type {
  Referral,
  ReferralCandidate,
  ReferralCode,
  ReferralOptions,
  ReferralStatus,
  ReferralStep,
  ReferralWithSteps,
  RewardRetryOptions,
  RewardStatus,
} from "./types";

/**
 * Gives users referral codes, attributes new users to the code they signed
 * up with (any sign-up method), and tracks steps a referral must complete
 * before it counts, e.g. a verified email or a first purchase.
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { referral } from "@checodo/better-auth-referral";
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     referral({
 *       steps: ["email-verified", "first-purchase"],
 *       onReferralCompleted: async ({ referrerUserId }) => {
 *         await grantCredit(referrerUserId);
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export const referral = (options: ReferralOptions = {}) => {
  const resolved = resolveOptions(options);

  return {
    id: "referral",
    version,
    init(ctx) {
      applyAuthDefaults(resolved, ctx);
      return { options: { databaseHooks: createDatabaseHooks(ctx, resolved) } };
    },
    // mergeSchema changes the object it gets, so each instance gets a copy.
    schema: mergeSchema(structuredClone(referralSchema), options.schema),
    endpoints: {
      ...createCodeEndpoints(resolved),
      ...createReferralEndpoints(resolved),
    },
    // Anyone can call check-code, so codes can't be guessed quickly.
    // Apps can change this with better-auth's `rateLimit.customRules`.
    rateLimit: [{ pathMatcher: (path) => path === "/referral/check-code", window: 60, max: 5 }],
    $ERROR_CODES: REFERRAL_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;
};

export type ReferralPlugin = ReturnType<typeof referral>;

/** Lets `auth.$context.getPlugin("referral")` infer this plugin's exact type. */
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    referral: {
      creator: typeof referral;
    };
  }
}
