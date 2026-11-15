import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const AUTHENTICATION_ERROR_CODES = defineErrorCodes({
  EMAIL_DOMAIN_RESERVED:
    "This email domain is reserved for accounts from a sign-in provider and can't be used",
});

export type AuthenticationErrorCode = keyof typeof AUTHENTICATION_ERROR_CODES;

/**
 * `error` values in the query of the error page a failed sign-in redirects
 * to (better-auth's `/error`, or `errorCallbackURL`), besides better-auth's own.
 */
export const AUTHENTICATION_CALLBACK_ERRORS = {
  /** The player cancelled on Steam's sign-in page. */
  STEAM_SIGN_IN_CANCELLED: "steam_sign_in_cancelled",
  /** Steam's answer didn't check out, or Steam couldn't confirm it. */
  STEAM_VERIFICATION_FAILED: "steam_verification_failed",
} as const;
