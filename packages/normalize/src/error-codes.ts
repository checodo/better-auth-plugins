import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

/**
 * A second account for the same inbox is refused with better-auth's own
 * `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, like an exact duplicate, so
 * clients need no new case and the answer reveals nothing more.
 */
export const NORMALIZE_ERROR_CODES = defineErrorCodes({
  INVALID_PHONE_NUMBER: "Invalid phone number",
});

export type NormalizeErrorCode = keyof typeof NORMALIZE_ERROR_CODES;
