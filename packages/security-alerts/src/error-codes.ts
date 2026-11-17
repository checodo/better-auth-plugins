import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const SECURITY_ALERTS_ERROR_CODES = defineErrorCodes({
  INVALID_TOKEN: "The link is invalid or has expired",
  DEVICE_NOT_FOUND: "No device was found with this id",
});

export type SecurityAlertsErrorCode = keyof typeof SECURITY_ALERTS_ERROR_CODES;
