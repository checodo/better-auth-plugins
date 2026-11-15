import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const REFERRAL_ERROR_CODES = defineErrorCodes({
  INVALID_REFERRAL_CODE: "This referral code is invalid",
  UNKNOWN_REFERRAL_STEP: "This referral step is not configured",
  CODE_GENERATION_FAILED: "Could not generate a unique referral code",
  METADATA_TOO_LARGE: "The metadata is too large",
  YOU_ARE_NOT_ALLOWED_TO_LIST_REFERRALS: "You are not allowed to list all referrals",
});

export type ReferralErrorCode = keyof typeof REFERRAL_ERROR_CODES;
