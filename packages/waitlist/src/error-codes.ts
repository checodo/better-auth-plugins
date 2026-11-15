import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const WAITLIST_ERROR_CODES = defineErrorCodes({
  EMAIL_NOT_APPROVED: "This email has not been approved to sign up yet",
  INVITE_CODE_REQUIRED: "An invite code is required to sign up",
  INVALID_INVITE_CODE: "This invite code is invalid or has expired",
  INVALID_TOKEN: "This link is invalid or has expired",
  WAITLIST_FULL: "The waitlist is full",
  ENTRY_NOT_FOUND: "No waitlist entry was found with this id",
  METADATA_TOO_LARGE: "The metadata is too large",
  YOU_ARE_NOT_ALLOWED_TO_MANAGE_WAITLIST: "You are not allowed to manage the waitlist",
});

export type WaitlistErrorCode = keyof typeof WAITLIST_ERROR_CODES;
