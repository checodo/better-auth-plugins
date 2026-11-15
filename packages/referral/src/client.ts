import type { BetterAuthClientPlugin } from "better-auth/client";
import { REFERRAL_ERROR_CODES } from "./error-codes";
import type { ReferralPlugin } from "./index";

/**
 * Client companion to `referral()`. Adds `authClient.referral.getCode`,
 * `createCode`, `regenerateCode`, `checkCode`, `listReferrals`, and
 * `listAllReferrals` (admins), typed from the server plugin. Pass the code
 * at sign-up in the `x-referral-code` header, or as
 * `additionalData.referralCode` of a social sign-in.
 *
 * @example
 * ```ts
 * import { createAuthClient } from "better-auth/client";
 * import { referralClient } from "@checodo/better-auth-referral/client";
 *
 * export const authClient = createAuthClient({
 *   plugins: [referralClient()],
 * });
 *
 * const { data } = await authClient.referral.createCode();
 * ```
 */
export const referralClient = () => {
  return {
    id: "referral",
    $InferServerPlugin: {} as ReferralPlugin,
    pathMethods: {
      "/referral/get-code": "GET",
      "/referral/create-code": "POST",
      "/referral/regenerate-code": "POST",
      "/referral/check-code": "GET",
      "/referral/list-referrals": "GET",
      "/referral/list-all-referrals": "GET",
    },
    $ERROR_CODES: REFERRAL_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};

export { REFERRAL_ERROR_CODES } from "./error-codes";
