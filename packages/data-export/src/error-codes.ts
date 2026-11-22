import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const DATA_EXPORT_ERROR_CODES = defineErrorCodes({
  EXPORT_TOO_LARGE: "The user has more data than one export may hold (maxRows)",
  EXPORT_FAILED: "Part of the user's data couldn't be read",
  NOT_ALLOWED: "Only admins can export another user's data",
  CROSS_SITE_REQUEST: "The download must be started from this site",
});

export type DataExportErrorCode = keyof typeof DATA_EXPORT_ERROR_CODES;
